# Input Secretary — product design

Status: **approved by owner** (2026-11-22) — agent on the Messages API in the Worker confirmed over Managed Agents
Satisfies: `requirements.md` (US-1…US-11, NFR-1…NFR-6, D1…D6)

## 1. Architecture at a glance

```
                 ┌──────────────────────── Cloudflare ─────────────────────────┐
 Browser (PWA) ──┤ web: Astro static + Lit  (Workers Static Assets)            │
                 │                                                             │
 REST / MCP / ───┤ core Worker (router)                                        │
 A2A clients     │   ├─ /api/*   REST  (OpenAPI 3.1)                           │
                 │   ├─ /mcp     MCP Streamable HTTP                           │
                 │   ├─ /a2a     A2A v1.0 JSON-RPC  + /.well-known/agent-card │
                 │   ├─ /oauth/* OAuth 2.1 AS (workers-oauth-provider)         │
                 │   └─ /bridge/* device ingest (Proton) + ACP relay           │
                 │        │                                                    │
                 │        ▼  one Durable Object per tenant                     │
                 │   TenantAgent DO (SQLite): sources, channels, categories,   │
                 │     input, briefings, queue, rules, usage; alarms = cron    │
                 │        │                                                    │
                 │        ▼                                                    │
                 │   CollectionWorkflow (Cloudflare Workflows): step per       │
                 │     source → normalise → agent ranking → briefing → push    │
                 │                                                             │
                 │   D1 "directory": users, passkeys, tenant→DO, OAuth         │
                 │     clients/grants, wrapped per-tenant data keys            │
                 └─────────────────────────────────────────────────────────────┘
                          │                         ▲
                          ▼                         │ device credential
            Claude API (Messages + MCP connector)   │
            Provider APIs (Graph, Gmail, Todoist,   │
            Discord REST, Yahoo IMAP)       local bridge (bun CLI on user PC)
                                             ├─ Proton Bridge IMAP → /bridge/ingest
                                             ├─ browser MCP → Outlook web UI → /bridge/ingest
                                             └─ `secretary acp` stdio ⇄ /bridge/acp
```

### Why this shape

| Choice | Reason | Rejected alternative |
|--------|--------|----------------------|
| One Durable Object per tenant (SQLite) | Isolation by construction (AC-1.2): code physically cannot query another tenant's DB; single-threaded actor serialises runs (AC-4.3); per-tenant alarms give per-user time-zone schedules (AC-5.1, 5.3) | Single D1 with `tenant_id` columns: isolation depends on every query remembering the filter |
| D1 only for the cross-tenant directory | Sign-in must resolve user → tenant before a DO is known | KV: no transactions for passkey counters / OAuth grants |
| Cloudflare Workflows for a collection run | Durable steps with retries per source; a run outlives one request; failed source does not fail the run (AC-4.2) | Doing it inside the DO alarm: one long invocation, no per-step retry |
| One operation registry projected to every interface | AC-11.1 / AC-7.1: each use case is declared once (zod in/out + handler) and rendered as REST route, MCP tool, A2A skill, ACP command and agent tool; parity is structural, not hand-kept | Separate handlers per interface: drift guaranteed |
| Agent loop on the Messages API (Tool Runner, `@anthropic-ai/sdk`) inside the Worker | Agent tools are tenant-scoped operations living in our DO; "What next" needs low latency; BYO key (D5) works with a per-request client | Claude Managed Agents: Anthropic-hosted loop + sandbox, but tools would call back into us anyway, per-user BYO keys would need agents provisioned in each user's org, and session runtime is billed on top of tokens |
| Knowledge-base MCP via the Claude API MCP connector (`mcp_servers` + `mcp_toolset`) | Anthropic calls the user's remote MCP servers; we only pass URL + token (AC-7.2) | Our own MCP client in the Worker: more code, same result |
| Local bridge for Proton and ACP | Proton Bridge is IMAP on `127.0.0.1`; ACP is stdio by spec; both need a process on the user's PC (D1) | Hosting Proton Bridge in the cloud: needs the user's Proton password server-side |
| Work mailbox through the browser UI on the bridge (D7) | The tenant blocks user consent to Graph mail scopes, while the user already reads the mailbox in a browser; the bridge reads what the user sees, with no credential leaving the browser | Reusing an allow-listed mail client's ID, or replaying the web session's token from the cloud: impersonates another application and moves a credential out of the user's control |

## 2. Repository layout (feature-based, DDD)

```
apps/
  core/        Cloudflare Worker + DO + Workflow
    src/features/
      tenancy/       domain · application · adapters (passkey, D1)
      sources/       domain (Source, Channel, Cursor) · ports (SourceConnector)
        connectors/  graph-mail · graph-teams · graph-calendar · gmail · todoist ·
                     discord · yahoo-imap · bridge-ingest (Proton, Outlook web)
      categories/    domain (Category, routing) · application
      collection/    domain (CollectionRun, CutOff) · workflow · scheduler
      briefing/      domain (Briefing sections) · application
      agent/         prompts · tool projection · quota · usage ledger
      queue/         domain (WorkQueue ordering) · application
      tasks/         application (add task, route to Todoist project)
      stats/         read models
      push/          Web Push (VAPID)
      interfaces/    rest · mcp · a2a · bridge  (thin projections of the registry)
    src/shared/      operation registry, crypto, result types, clock
  web/         Astro pages + Lit components (PWA, service worker)
    src/features/<same names>/components
  bridge/      bun CLI: `secretary pair|proton|owa|acp`
packages/
  contracts/   zod schemas for every operation (single source for OpenAPI, MCP, A2A)
  domain-kit/  pure helpers shared by core and bridge (Result, ids, time)
specs/         requirements → design → tasks per spec
```

Layers inside each feature: **domain** (pure functions + types, no I/O) → **application** (use cases, depend on ports) → **ports** (interfaces) → **adapters** (D1/DO SQL, HTTP providers, Claude). Interfaces never call adapters directly.

## 3. Domain model (per tenant, DO SQLite)

| Entity | Key fields | Notes |
|--------|------------|-------|
| `Source` | id, provider, label, status (`ok`/`needs_reconnect`/`needs_admin_consent`/`unavailable`/`disabled`), credentialRef, cursor | cursor is provider-specific (Graph delta link, Gmail historyId, IMAP UID, Discord snowflake, Todoist sync token) |
| `Channel` | id, sourceId, externalId, name, enabled, categoryId? | AC-2.5, AC-3.2 |
| `Category` | id, name, order, profile (`work`/`personal`/custom), todoistProjectIds[], defaultProjectId? | AC-3.1, 3.3 |
| `InputItem` | id, sourceId, channelId, externalId (unique per source), kind (`mail`/`chat`/`mention`/`task`/`event`), from, subject, snippet, body?, url, receivedAt, categoryId?, categorySuggestion {id, confidence}?, importance (0–100)?, importanceReason?, state (`new`/`briefed`/`converted`/`dismissed`) | unique (sourceId, externalId) gives AC-4.5; body purged after retention (NFR-2) |
| `ScheduleRule` | id, days (ISO weekday set), time, tz, categoryIds[] or `all_except_work`, enabled | defaults per AC-5.1 |
| `CollectionRun` | id, trigger (`manual`/`rule:<id>`/`api`), categoryScope, startedAt, finishedAt, status, perSource [{sourceId, ok, count, error?}] | |
| `Briefing` | id, runId, createdAt, degraded, sections {newInput[], deadlines[], today[], needsUpdate[]} | each entry has origin URL + itemId (AC-6.2) |
| `QueueEntry` | todoistTaskId, pinnedUrgent, state (`queued`/`in_progress`/`done`/`postponed`/`skipped`), advice? | order is computed, not stored (§6) |
| `KnowledgeBase` | id, name, url, credentialRef, enabled | AC-7.2 |
| `AgentRun` | id, purpose, model, inputTokens, outputTokens, costMicros, toolCalls[], keySource (`platform`/`byo`) | AC-7.3, 7.5 |
| `PushSubscription` | endpoint, keys, device label | AC-5.4; deleted when the push service answers 404/410 |

**Cut-off marker** = the tenant's last fully successful run start. Each source keeps its own cursor, advanced only when that source's step succeeds (AC-4.1, 4.2).

## 4. Operation registry (contract surface)

Every row is one zod contract in `packages/contracts` and one application use case; REST path, MCP tool name, A2A skill and agent tool are generated from it.

| Operation | REST | MCP tool | A2A skill | Agent tool | US |
|-----------|------|----------|-----------|------------|----|
| `sources.list` / `channels.list` / `channels.update` | `GET /api/sources`… | `sources_list`… | — | read | 2 |
| `categories.*` (list, create, update, delete, bindProjects) | `/api/categories` | `categories_*` | — | read | 3 |
| `input.query` (filters: category, source, state, since, text) | `GET /api/input` | `input_query` | query-input | read | 4, 7 |
| `collection.run` (scope?) | `POST /api/collection-runs` | `collect_input` | collect-input | — (never from agent) | 4 |
| `collection.status` | `GET /api/collection-runs/{id}` | `collection_status` | (task status) | read | 4 |
| `schedule.*` | `/api/schedule-rules` | `schedule_*` | — | — | 5 |
| `briefing.latest` / `briefing.get` / `briefing.list` | `/api/briefings` | `briefing_get`… | get-briefing | read | 6 |
| `queue.next` / `queue.complete` / `queue.postpone` / `queue.skip` | `/api/queue/*` | `what_next`… | what-next | — | 8 |
| `tasks.add` (text, urgent, categoryHint?) | `POST /api/tasks` | `add_task` | add-task | propose only | 9 |
| `stats.get` (metric, groupBy, range) | `GET /api/stats` | `stats_get` | — | read | 10 |
| `knowledge.*`, `agent.usage`, `llmKey.set` | `/api/agent/*` | — (UI/API only for secrets) | — | — | 7 |

Rule: tools that **write** to Todoist or change state are never given to the agent while it reads input (ranking, briefing). The agent only *proposes*; the use case applies the proposal. This is the main defence for AC-7.4.

## 5. Connectors (US-2)

Port:

```ts
type SourceConnector = {
  readonly listChannels: (cred: Credential) => Promise<Result<readonly ChannelRef[]>>
  readonly fetchSince: (cred: Credential, channels: readonly ChannelRef[], cursor: Cursor | undefined)
    => Promise<Result<{ readonly items: readonly RawItem[]; readonly cursor: Cursor }>>
}
```

| Connector | Mechanism | Cursor | Notes |
|-----------|-----------|--------|-------|
| Outlook mail | Graph `/me/mailFolders/{id}/messages/delta` | deltaLink | scopes `Mail.Read offline_access` |
| Outlook calendar | Graph `/me/calendarView/delta` | deltaLink | feeds the deadlines section |
| Teams | Delegated Graph: `/me/chats` (ordered by last message) then `/chats/{id}/messages` newer than the cursor; `getAllMessages` is application-only and metered, so not used | per-chat `lastModifiedDateTime` | `Chat.Read`; channel messages need `ChannelMessage.Read.All` (admin consent) → optional per tenant |
| Gmail | `users.history.list` from `historyId`, `messages.get(format=metadata)` | historyId | testing mode (D6) |
| Todoist | API v1 sync (`/sync`, `sync_token`) | sync_token | also the task sink; new/changed tasks and comments are input |
| Discord | Platform bot, REST `GET /channels/{id}/messages?after=` for opted-in guild channels | snowflake per channel | DMs to the bot need the Gateway → later task; personal DMs impossible (requirements §2) |
| Yahoo | OAuth `mail-r`, then IMAP over `cloudflare:sockets` TLS, `UID SEARCH UID n:*` | UIDVALIDITY + UID | **gated by Yahoo's commercial approval (S2)**; the workerd IMAP client is built only after approval |
| Proton | bridge reads Proton Bridge IMAP with `imapflow`, POSTs `RawItem[]` to `/bridge/ingest` | kept by the bridge, acknowledged by core | items arrive whenever the PC is on; the run includes what has arrived since the cut-off |
| Outlook on the web (D7) | on a `collect` job the bridge drives the user's browser through a browser-automation MCP server (stdio, configured on the bridge), reads the message list and the opened messages, POSTs `RawItem[]` to `/bridge/ingest` | newest `receivedAt` + the message ids seen at that time, kept by core | see §5.1 |

### 5.1 Outlook on the web through the bridge (D7)

- **Job flow.** The bridge keeps a long poll on `GET /bridge/jobs`. When a run includes a bridge source, the run's step for it enqueues a `collect` job (source id, cursor, deadline) and waits with `step.waitForEvent` for the bridge's ingest acknowledgement; on timeout the source is `failed: bridge_offline` for that run only (AC-2.8, AC-4.2).
- **Reading.** The bridge opens or reuses one mail tab, brings it to the front only for the read (a hidden tab renders no list), waits for the message list by an element signal (no sleeps), and reads rows top-down until it reaches the cursor. For each new row it opens the message and takes sender, recipients, subject, received time, a body text excerpt and a deep link; then it restores the previously active tab.
- **Selectors.** All markup knowledge lives in one adapter file of selectors and pure parse functions, unit-tested against saved, scrubbed DOM fixtures; S5 records which attributes are stable. A markup change makes the parse fail loudly (`failed: markup_changed`), never ingest partial data silently.
- **Signed out.** If the page shows a sign-in form, the source becomes `needs_reconnect` with reason `signed_out`; the bridge never types credentials.
- **Boundaries (AC-2.9).** The bridge calls only navigation, wait, query and click tools of the browser MCP; it never evaluates scripts that read `document.cookie`, storage or network headers, and the adapter has a unit test that the tool list it uses is exactly that allow-list.
- **MCP config.** The browser MCP server is a local stdio command in the bridge config (`secretary owa configure`), never sent to core.

Credentials: OAuth tokens and app passwords are encrypted with the tenant's data key (AES-GCM via WebCrypto); the data key is wrapped by a KEK held as a Worker secret and stored in D1 (envelope encryption, NFR-1). Token refresh happens inside the connector step; a refresh failure sets `needs_reconnect` (AC-2.4).

## 6. Collection, scheduling, briefing (US-4…US-6)

1. Trigger (button, API, MCP, A2A, or DO alarm for a rule) → `collection.run` use case in the tenant DO.
2. DO checks for an active run: if one exists it returns that run's id (join, AC-4.3); else records `CollectionRun` and starts `CollectionWorkflow(tenantId, runId, scope)`.
3. Workflow steps: `fetch:<sourceId>` per enabled source (parallel, retried, isolated) → `normalise+dedupe` (insert-or-ignore on (sourceId, externalId)) → `classify+rank` (agent) → `compose briefing` (agent, structured output) → `notify` (Web Push) → `commit` (advance cursors of successful sources, cut-off if all succeeded).
4. Scheduler: on rule change the DO recomputes the next fire time across rules (in each rule's tz, DST-safe) and sets one alarm; the alarm handler starts a run and re-arms. A global Cron Trigger every 5 min re-arms any DO whose alarm is missing (watchdog for AC-5.3).

Briefing composition:
- *newInput*: items in scope since cut-off, ranked by importance (agent), each with a one-line reason.
- *deadlines*: Todoist tasks with due dates + calendar events, next 14 days (deterministic, no LLM).
- *today*: due today/overdue + agent-picked items from new input that need action today.
- *needsUpdate*: overdue > N days, tasks untouched > 14 days, tasks the agent finds contradicted by new input.
- Degraded mode (AC-6.4, 7.5): if the agent step fails or quota is exhausted, deterministic sections are kept and *newInput* is grouped by category, newest first, flagged `degraded`.

## 7. Agent (US-7, US-8, US-9)

- SDK: `@anthropic-ai/sdk`, Tool Runner with `betaZodTool` tools generated from the registry's read operations; structured outputs for ranking/briefing/advice.
- Model: `claude-opus-5-5`, adaptive thinking, effort per purpose (`low` for ranking, `medium` for briefing and what-next); server-side `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) enabled; `refusal` stop reason handled → degraded output. Model and effort configurable per tenant.
- Knowledge bases: per request, the tenant's enabled `KnowledgeBase` rows become `mcp_servers` + `mcp_toolset` entries (beta `mcp-client-2025-11-20`).
- Untrusted input: item content is placed in tool results / document blocks inside explicit data delimiters; the system prompt states it is data; no write tools while reading input (§4). A red-team fixture set (emails that say "create a task…", "ignore previous…", "send …") is part of the unit suite (AC-7.4).
- Caching: stable system prompt + tool list first, tenant context (categories, routing rules) second, volatile input last; cache breakpoints after the first two.
- Key and quota (D5): platform key by default with a per-tenant daily token budget kept in the DO usage ledger; a BYO key (encrypted like other credentials) bypasses the budget (AC-7.5, 7.6).
- Routing a new task (AC-9.3, 9.4): candidate projects = Todoist projects bound to the hinted/suggested category; their descriptions are the routing rules; the agent returns `{projectId, ruleQuote, confidence}`; below threshold → category default project or Inbox + `needs_review` label.

Work queue order (AC-8.3), pure function in `queue/domain`:
`pinnedUrgent desc → inLatestBriefingToday desc → dueDate asc (undefined last) → todoistPriority desc → importance desc → createdAt asc`.

## 8. Interfaces (US-11)

- **REST**: Hono router over the registry; OpenAPI 3.1 generated from zod; auth = session cookie (UI) or OAuth bearer / personal access token.
- **MCP**: Streamable HTTP at `/mcp`, OAuth 2.1 via `@cloudflare/workers-oauth-provider` (dynamic client registration, PKCE); stateless handler per request that forwards to the tenant DO (no per-session DO needed).
- **A2A v1.0**: Agent Card at `/.well-known/agent-card.json` with a JSON-RPC interface at `/a2a`, `A2A-Version: 1.0`, OAuth2 security scheme pointing at our AS; skills from §4; long operations (collect) return a Task and stream status. `@a2a-js/sdk@1.3.0`, Worker flag `nodejs_compat` (the SDK uses `Buffer`), a custom `TaskStore` on the tenant DO; v0.3 clients are rejected.
- **ACP**: `secretary acp` in the bridge (`@agentclientprotocol/sdk@2.9.1`, ACP v1 stable entry point only) — `initialize`, `session/new`, `session/prompt` relayed to `/bridge/acp` (SSE stream of agent text and tool-call updates). Slash commands map to registry operations (`/collect`, `/next`, `/add`, `/briefing`).
- **Parity test** (AC-11.4): one scenario script run against REST, MCP, A2A and ACP adapters with fake providers.

## 9. Auth and tenancy (US-1)

- Sign-up/sign-in: passkeys only (`@simplewebauthn/server`), discoverable credentials, multiple devices, recovery codes (per `passkey-auth` skill).
- Session: HttpOnly, Secure, SameSite=Lax cookie holding an opaque id → D1.
- Every request resolves `tenantId` once at the edge; the router obtains `TENANT_DO.get(idFromName(tenantId))`; no other path to tenant data exists.
- Account deletion: revoke provider tokens (Graph, Google, Todoist revoke endpoints), `deleteAll()` on the DO storage, delete D1 rows, destroy the wrapped data key (crypto-shredding of any backup).

## 10. UI (Astro + Lit PWA)

Pages: **Today** (latest briefing, "Collect input" button, run status), **Next** (current task + advice, complete/postpone/skip, "What next"), **Inbox** (input list with filters, bulk categorise), **Add task** (global shortcut + dialog, urgent toggle), **Stats**, **Settings** (Sources, Channels→Categories mapping, Categories↔Todoist projects, Schedule rules, Knowledge bases, LLM key & usage, API tokens & bridge devices, Push).

- Design tokens and mock-ups in local Penpot before implementation (designer agent); colour system AAA contrast (7:1 text), focus-visible on everything, reduced-motion respected, full keyboard operation, live regions for run progress.
- Performance budget: LCP < 1.5 s on 4G, JS < 80 KB gz on first route, islands only where interactive.
- Charts follow the `dataviz` skill; each chart has a table alternative (AAA).

## 11. Quality gates (CI, GitHub Actions)

lint (Biome + eslint-plugin-functional rules from `functional-frontend`), `tsc --noEmit`, unit (Vitest + `@cloudflare/vitest-plugin`, run with `bun --bun`), contract tests per connector with recorded fixtures, E2E (Playwright under `bun --bun`, bun 1.4.5+, against the PR preview; locally the Worker is bundled with `Bun.build` and served by Miniflare because `wrangler dev` answers 503 under bun on Windows), security (CodeQL, gitleaks, osv-scanner), Lighthouse CI budget, a11y (axe in E2E). Deploy only from CI: PR → preview, `main` → production (NFR-5).

## 12. Spikes before committing to tasks

| Spike | Question | Exit criterion |
|-------|----------|----------------|
| S1 | Graph Teams chat read with delegated `Chat.Read` on a personal and a work tenant | messages since T returned for both, or admin-consent requirement documented |
| S2 | IMAP over `cloudflare:sockets` against Yahoo | UID SEARCH + FETCH headers works in workerd; else Yahoo moves to the bridge |
| S5 | Outlook on the web read through a browser-automation MCP from bun | stable ids and attributes for list rows and the reading pane recorded; 20 newest messages read with counts only printed, no content |
| S3 | Web Push from workerd (VAPID + aes128gcm with WebCrypto) | push delivered to Chrome and Firefox |
| S4 | A2A v1.0 and ACP SDK versions | pinned versions + a hello-world for each |

## 13. Traceability

| Requirement | Design section |
|-------------|----------------|
| US-1, AC-1.x | §1 (DO per tenant), §9 |
| US-2 | §5 |
| US-3 | §3, §7 routing |
| US-4, US-5 | §6 |
| US-6 | §6 briefing |
| US-7 | §7 |
| US-8, US-9 | §7 queue + routing |
| US-10 | §2 `stats`, §10 |
| US-11 | §4, §8 |
| NFR-1 | §5 credentials, §9, §11 |
| NFR-2 | §3 InputItem retention, §9 deletion |
| NFR-3, NFR-4 | §10 |
| NFR-5 | §11 |
| NFR-6 | §2 |
