# Input Secretary — phase-0 spike results

## S1 — Microsoft Graph: mail, calendar, Teams chats (2026-11-22)

Status: **personal account done; work tenant blocked on admin consent**. The probe printed HTTP statuses and counts only, never content; its code is not kept in the repository.

- Entra app **Input Secretary** registered in the owner's personal Entra directory (not in an employer's tenant); the client ID lives in deployment configuration, not in the repository; audience `AzureADandPersonalMicrosoftAccount`.
- Redirects: Web `http://localhost:8790/oauth/microsoft/callback` (core, confidential client later); public client `http://localhost` (PKCE, used by the probe and the local bridge). No client secret exists yet.
- Delegated scopes requested dynamically: `offline_access User.Read Mail.Read Calendars.Read Chat.Read`.

| Check | Personal account | Work account (employer tenant) |
|-------|------------------|--------------------|
| Sign-in and consent | user consent, refresh token issued | **"Need admin approval"**: the tenant does not allow user consent for this unverified app; no token issued |
| Granted scopes | `openid profile User.Read Mail.Read Calendars.Read` (`Chat.Read` not granted) | none |
| `/me` | 200 | not tested |
| Inbox delta | 200, 10 items | not tested |
| `calendarView` | 200, 0 items in the window | not tested |
| `/me/chats` | **401** | not tested |

Findings:

- Teams chats are not readable for a personal Microsoft account through this app: `Chat.Read` is dropped at consent and `/me/chats` returns 401. **Amendment proposal**: the Teams connector applies to work/school accounts only; the UI hides it for personal accounts.
- A work tenant can require admin consent. **Amendment proposal**: AC-2.4 gains a `needs_admin_consent` source state that names the blocked scopes and offers an admin-consent link.
- Mail, calendar and Teams on the work tenant remain **unverified** until the consent decision is made. The consent was not bypassed.
- **Root cause of the work-tenant block (2026-11-23).** The tenant uses "Let Microsoft manage your consent settings". Under it, users cannot self-consent to mail, calendar and chat permissions (`Mail.Read`, `Calendars.Read`, `Chat.Read`, `IMAP.AccessAsUser.All`, ...), except for six allowlisted mail clients: Apple Mail, Spark, eM Client, Thunderbird, Android-Samsung, Android-Mail ([Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies)). IMAP does not avoid the gate, and publisher verification does not lift it.
- **Rule.** The product never reuses another application's client ID and never takes tokens from a browser session. A work tenant connects through admin consent, preferably a single-user grant (`consentType=Principal`).
- **Owner decision (2026-11-23).** v1 is built without the work mailbox, on the personal Outlook and Todoist; the work tenant can be connected later without an architecture change.
- **Owner decision (2026-11-24, D7).** The work mailbox comes in through the local bridge reading Outlook on the web in the user's signed-in browser (design §5.1, spike S5). A first probe: the mailbox opened signed in, but a hidden tab rendered no message list (`visibilityState: hidden`, 52 characters of body text), so the read brings the tab to the front.

## S2 — Yahoo Mail (2026-11-22)

Status: **blocked by provider policy**. Owner decision: no app passwords, OAuth only.

- The Yahoo developer console offers only OpenID and Fantasy Sports scopes; IMAP/CalDAV/CardDAV OAuth scopes (`mail-r`) are not self-service.
- Access requires a reviewed commercial application: https://senders.yahooinc.com/developer/developer-access (form hosted at `vzmmemberservices.my.salesforce-sites.com/?fc=YDN`). Required fields include company name, product URL and a privacy-policy URL **on the same domain**, data collection/use/sharing statements, GDPR/CCPA compliance, expected users and API calls, and a YDN account.
- Consequence: Yahoo cannot be built until the product has a domain + privacy policy and Yahoo approves the request. The IMAP-over-`cloudflare:sockets` question is moot until then.
- **Amendment proposal**: AC-2.2 changes from "app password" to "OAuth (`mail-r`) after Yahoo approval"; Yahoo moves behind a "provider approval" gate in `02-connectors`.

## S3 — Web Push from workerd

Status: **done, positive** (2026-11-22). Code: `spikes/s3-web-push/`.

**Question.** Can the core Worker send Web Push (VAPID, RFC 8292 + `aes128gcm`, RFC 8291) with WebCrypto only, and do Chrome and Firefox receive it?

**Answer: yes.** Use `@block65/webcrypto-web-push` **2.0.0** (published 2026-09-15, MIT, one runtime dependency `uint8array-extras`, WebCrypto only). 2.x sends `aes128gcm` + the `vapid t=…, k=…` scheme (1.x sent legacy `aesgcm`/`WebPush`, which Apple rejects). API: `buildPushPayload(message, subscription, vapid)` returns a `RequestInit`; we call `fetch(subscription.endpoint, payload)` ourselves.

| Check | Where | Result |
|-------|-------|--------|
| Runs inside workerd | Vitest + `@cloudflare/vitest-plugin` 1.9.0 (`navigator.userAgent === "Cloudflare-Workers"`) | pass |
| Our independent RFC 8291 receiver decrypts the RFC 8291 Appendix A example | same | pass |
| Library output decrypts with that receiver (round trip) | same | pass |
| VAPID JWT: ES256 signature verifies with the server key, `aud` = endpoint origin, `exp` ≤ 24 h, `k` = public key | same | pass |
| Real delivery, Google Chrome 152 (installed, Playwright `channel: "chrome"`) | `wrangler dev` → FCM `201` → service worker `push` → page | **received** |
| Real delivery, Firefox (Gecko 159, Playwright's Firefox build, headless) | `wrangler dev` → Mozilla autopush `201` → service worker → page | **received** |

Test run: `bunx vitest run` → 4 passed. Delivery on bun only: `bun --bun scripts/bun-only-e2e.ts <dir>`; evidence screenshots were saved outside the repo (scratchpad `s3-evidence/`).

Not verified: the owner's installed Firefox (Playwright drives only its own Gecko build) and Safari/iOS (needs an installed PWA on Apple hardware; 2.x uses the scheme Apple accepts).

### Gotchas for the implementation

- `@cloudflare/vitest-pool-workers` is **deprecated**, renamed to `@cloudflare/vitest-plugin` (Vitest ≥ 4.1; config `plugins: [cloudflareTest({ wrangler: { configPath } })]`). Design §11 and T0.3 name the old package — **amendment proposal**: use `@cloudflare/vitest-plugin`.
- `@cloudflare/workers-types` types `generateKey`/`exportKey` as unions and names the ECDH member `$public` (runtime wants `public`); narrow once in a helper, don't cast.
- Playwright hung on Windows under **bun 1.3.9**. On **bun 1.4.5** it launches Chrome and Firefox and the whole check runs without node (`bun --bun scripts/bun-only-e2e.ts <dir>`: both browsers received the push). `wrangler dev` still answers 503 under bun 1.4.5 on Windows, so local E2E bundles the Worker with `Bun.build` and serves it through Miniflare.
- Push subscribe fails in incognito-style contexts: E2E must use `launchPersistentContext`. Grant `notifications` via `context.grantPermissions`.
- Playwright's Firefox disables push (`dom.push.serverURL = ""`, `dom.push.connection.enabled = false`); set them back to `wss://push.services.mozilla.com/` / `true`. Its headed mode crashed on this workstation (GPU); headless works.
- Cold Chrome profile: first FCM registration took > 30 s once; wait ceilings must be env-tunable (`PUSH_WAIT_MS`).
- FCM returns `201` for a subscription whose browser is closed (delivered later). Expired/unsubscribed endpoints return `404`/`410`: the push feature must delete the `PushSubscription` on those codes — **amendment proposal** for design §3 `PushSubscription` (+ AC-5.4 test).
- Payload is padded to 4096 octets, max 3993 bytes of data: push only a short summary + briefing id, never the briefing body (also keeps input content out of push services).
- VAPID keys: public = base64url raw P-256 point (65 bytes), private = JWK `d`. Generate once (`bun run vapid`), keep as Worker secrets (`VAPID_PRIVATE_KEY`), never in the repo.

## S4 — A2A v1.0 and Agent Client Protocol (2026-11-22)

Code: `spikes/s4-a2a-acp/` · run `bun install --cwd spikes/s4-a2a-acp && bun test --cwd spikes/s4-a2a-acp`
Result: **5/5 tests pass**, `tsc --noEmit` clean (TypeScript 7.0.2, strict + `exactOptionalPropertyTypes`).

### Pinned versions

| What | Version | Source |
|------|---------|--------|
| A2A protocol | **v1.0.0** | https://a2a-protocol.org/v1.0.0/specification/ |
| A2A JS/TS SDK | `@a2a-js/sdk` **1.3.0** (npm, 2026-09-29), official, implements spec v1.0.0, opt-in v0.3 compat layer | https://github.com/a2aproject/a2a-js |
| Agent Client Protocol | protocol **v1** (`PROTOCOL_VERSION = 1`, stable default entrypoint); v2 is "Preview" under `/experimental/v2` | https://agentclientprotocol.com |
| ACP TS SDK | `@agentclientprotocol/sdk` **2.9.1** (npm, 2026-11-21); peers `zod ^3.25.76 \|\| ^4`, `@modelcontextprotocol/server ^2.4.0` | https://github.com/agentclientprotocol/typescript-sdk |

### A2A v1.0 — verified facts

- Agent Card path: `/.well-known/agent-card.json` (`AGENT_CARD_PATH`); the 0.2.x `agent.json` path is obsolete.
- Card shape (v1.0): `name`, `description`, `version`, `provider`, **`supportedInterfaces[]`** (`{ url, protocolBinding: "JSONRPC" | "HTTP+JSON" | "GRPC", protocolVersion, tenant }`, first = preferred; there is no single top-level `url` any more), `capabilities` (`streaming`, `pushNotifications`, `extensions`, `extendedAgentCard`), `securitySchemes` (map) + `securityRequirements[]`, `defaultInputModes`/`defaultOutputModes`, `skills[]` (`id`, `name`, `description`, `tags`, `examples`, modes, per-skill `securityRequirements`), optional JWS `signatures[]`.
- Header `A2A-Version: 1.0` on every request. **A missing header means 0.3**; a v1.0-only card rejects it with `VersionNotSupportedError` (test: "request without A2A-Version … rejected"). v0.3 peers are accepted only with `legacyCompat: { enabled: true }` or a per-interface `protocolVersion: "0.3"`.
- Wire format is ProtoJSON: PascalCase methods (`SendMessage`, `SendStreamingMessage`, `GetTask`, `CancelTask`…), enum strings (`ROLE_USER`, `TASK_STATE_COMPLETED`), parts as `{ "text": … }` / `{ "url": … }` / `{ "data": … }` / `{ "raw": base64 }`. In TS the SDK models parts as `{ content: { $case: "text", value } }`.
- Server model: `AgentExecutor.execute(ctx, bus)` must publish a `message` or `task` event first; `DefaultRequestHandler` + `JsonRpcTransportHandler.handle(body, ServerCallContext)` returns a JSON-RPC response or an `AsyncGenerator` (stream → SSE via `formatSSEEvent`).

### A2A on Cloudflare Workers — verified

- `@a2a-js/sdk` root, `/server` and `/client` import only `jose`; `/server/express` and `/server/grpc` are Node-only and not needed. The spike's handler is a plain `(Request) => Promise<Response>` built on `JsonRpcTransportHandler` (no Express).
- Ran the same handler in local workerd (`wrangler dev`, wrangler 4.162.0, `compatibility_date 2026-11-01`): agent card served, `SendMessage` returned `echo: hello from workerd`. Nothing was deployed.
- The SDK uses the global **`Buffer`** (raw parts, `ListTasks` page tokens) → the Worker needs the **`nodejs_compat`** flag.

### ACP — verified facts

- API style is the **builder API** (not the older `AgentSideConnection` class):
  - agent: `agent({ name }).onRequest(methods.agent.initialize, …).onRequest(methods.agent.session.new, …).onRequest(methods.agent.session.prompt, …).connect(ndJsonStream(stdout, stdin))`; streaming text goes out as `client.notify(methods.client.session.update, { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } })`, the prompt resolves with `{ stopReason: "end_turn" }`.
  - client: `client({ name }).connectWith(ndJsonStream(toAgent, fromAgent), async (agent) => { await agent.request(methods.agent.initialize, …); return agent.buildSession(cwd).withSession((s) => s.prompt("…") … s.readText()) })`.
- Transport: newline-delimited JSON-RPC over stdio (`ndJsonStream` over Web Streams); no batches.
- `@agentclientprotocol/sdk/experimental/http-client` exists (ACP over an HTTP stream) — experimental, not used.

### Gotchas

1. `DefaultRequestHandler` with `InMemoryTaskStore` loses tasks between Worker isolates/requests. Production needs a `TaskStore` backed by the tenant Durable Object (or the SDK's `DatabaseTaskStore` on D1 via Kysely).
2. Server-side auth in the SDK is shown only as Express/Passport middleware; on Workers we build `ServerCallContext` ourselves with a `User` derived from our OAuth bearer token.
3. `AgentInterface.tenant` and `SendMessageRequest.tenant` exist and `DefaultExecutionEventBusManager` scopes by tenant — usable, but our isolation stays the DO-per-tenant routing; the A2A `tenant` field is left empty.
4. ACP SDK releases very often (2.9.1 published a day before this spike) and v1/v2 entrypoints must not be mixed: pin the exact version and keep it behind the bridge's ACP adapter.

### Amendment proposals for design §8 (not applied)

- **A2A**: add "Worker compatibility flag `nodejs_compat` (SDK uses `Buffer`)", "A2A task store = custom `TaskStore` on the tenant DO", and "v0.3 clients are rejected (no `legacyCompat`) unless a need appears". Path and header in §8 are confirmed as written.
- **ACP**: replace "version pinned at implementation" with "`@agentclientprotocol/sdk@2.9.1`, ACP v1 stable entrypoint only (v2 Preview excluded)".
