# Input Secretary — product requirements

Status: **approved by owner** (2026-11-22)

## 1. Overview

Input Secretary aggregates incoming items ("input") from a user's communication
and task tools, sorts them into user-defined categories bound to Todoist
projects, and runs an AI agent that turns the input into a prioritised daily
briefing and a "what next" work queue. Every capability is reachable from the
web UI, a REST API, an MCP server, and agent protocols (A2A, Agent Client
Protocol), so an external LLM can do the same work a human does in the UI.

### Decisions already taken (owner, 2026-11-22)

| # | Decision | Consequence |
|---|----------|-------------|
| D1 | Cloud core on Cloudflare + a local bridge | Scheduler runs with the PC off; ProtonMail (Bridge on localhost) and Agent Client Protocol (stdio) go through a local bun process |
| D2 | A2A **and** Agent Client Protocol, in addition to REST and MCP | Two agent-facing adapters over one application core |
| D3 | Multi-user from day one | Tenant isolation, per-user OAuth grants, per-user secrets, public OAuth app verification |
| D4 | Report delivery: UI + MCP + Web Push (PWA) | No email/Discord delivery in v1 |
| D5 | LLM cost: platform key with a per-user daily quota by default; a user's own Anthropic key lifts the quota | Quota metering and BYO-key storage (AC-7.5, AC-7.6) |
| D6 | Gmail API in Google "testing" mode for v1 (≤100 named users, 7-day refresh tokens); verification before public launch | Gmail source needs periodic reconnect (AC-2.4 covers it) |

### Glossary

- **Source** — a connected account of one provider (e.g. "Gmail: work@…").
- **Channel** — a sub-stream inside a source (Gmail label, Outlook folder, Teams chat, Discord channel, Todoist project inbox).
- **Input item** — one normalised incoming unit (email, chat message, mention, task, calendar event).
- **Category** — a user-defined life area (Work, Home, …) with a schedule profile and bound Todoist projects.
- **Routing rule** — a project's description text in Todoist that tells the agent which tasks belong there.
- **Cut-off marker** — the per-user timestamp up to which input has been collected and briefed.
- **Briefing** — the report produced by a collection run.
- **Work queue** — ordered list of actionable tasks consumed by "What next".

## 2. Sources (connectors)

| Provider | Access path | Known constraint |
|----------|-------------|------------------|
| Microsoft Teams | Microsoft Graph, delegated OAuth (chats, channel messages, mentions) | Work/school accounts only (`Chat.Read` is not granted to personal accounts, S1); tenants can require admin consent |
| Outlook (mail + calendar) | Microsoft Graph, delegated OAuth | Verified for personal accounts (S1); work tenants can require admin consent |
| Gmail | Gmail API, OAuth | `gmail.readonly` is a restricted scope: a public multi-user app needs Google verification + annual security assessment |
| Todoist | Todoist API v1, OAuth | Also the task sink (see §6) |
| Discord | Bot in servers the user adds it to + DMs sent to the bot | Discord does not let a bot read a user's personal DMs; user tokens break the ToS |
| Yahoo Mail | IMAP with OAuth (`mail-r`); no app passwords (owner, 2026-11-22) | Needs Yahoo's reviewed commercial access: product domain, privacy policy on it, approval (S2) |
| ProtonMail | IMAP via Proton Bridge on the user's PC, through the local bridge | Needs a paid Proton plan and the PC on at collection time |

## 3. User stories and acceptance criteria

### US-1 Account and tenancy

- AC-1.1 WHEN a visitor signs up THE SYSTEM SHALL create an isolated tenant and enrol a passkey as the only sign-in factor.
- AC-1.2 THE SYSTEM SHALL scope every read and write of input, categories, briefings, queue and secrets to the caller's tenant; a request carrying tenant A's credential SHALL never return tenant B's data (tested for every API, MCP, A2A and ACP operation).
- AC-1.3 WHEN a user deletes the account THE SYSTEM SHALL revoke all provider grants, delete all stored input and secrets, and confirm completion.

### US-2 Connect sources

- AC-2.1 WHEN a user connects an OAuth provider THE SYSTEM SHALL run the authorisation-code flow with PKCE and a single-use `state`, and store the refresh token encrypted per tenant.
- AC-2.2 WHERE Yahoo has approved the product's access THE SYSTEM SHALL connect Yahoo through the OAuth flow of AC-2.1 with the `mail-r` scope; WHILE approval is missing THE SYSTEM SHALL show Yahoo as unavailable and SHALL NOT accept passwords.
- AC-2.3 WHEN a user pairs the local bridge THE SYSTEM SHALL issue a device credential bound to that tenant, revocable from the UI.
- AC-2.4 IF a provider grant expires or is revoked THEN THE SYSTEM SHALL mark the source "needs reconnect", keep collecting the other sources, and show the reason in the UI and in the next briefing.
- AC-2.5 THE SYSTEM SHALL list the channels of each source so the user can include or exclude each one.
- AC-2.6 IF a work tenant requires admin consent THEN THE SYSTEM SHALL mark the source `needs_admin_consent`, name the blocked scopes, offer the admin-consent link, and keep collecting the other sources.
- AC-2.7 THE SYSTEM SHALL offer the Teams connector only for work/school accounts.

### US-3 Categories and Todoist binding

- AC-3.1 THE SYSTEM SHALL let a user create, rename, reorder and delete categories; defaults "Work" and "Personal" exist after sign-up.
- AC-3.2 THE SYSTEM SHALL let a user assign each channel to exactly one category (or "Unassigned").
- AC-3.3 THE SYSTEM SHALL let a user bind one or more Todoist projects to a category.
- AC-3.4 WHEN an input item arrives from an unassigned channel THE SYSTEM SHALL let the agent propose a category, marked as a suggestion until the user confirms or a confidence threshold set by the user is met.

### US-4 Collect input ("Collect input" button and scheduler)

- AC-4.1 WHEN the user presses "Collect input" THE SYSTEM SHALL fetch every item newer than the cut-off marker from every enabled channel, normalise and deduplicate them, produce a briefing, and move the cut-off marker to the collection start time.
- AC-4.2 IF one or more sources fail during collection THEN THE SYSTEM SHALL keep the cut-off marker of the failed sources unchanged, so their items are picked up next run, and name the failed sources in the briefing.
- AC-4.3 WHILE a collection run is in progress for a tenant THE SYSTEM SHALL reject or join a second run for that tenant instead of starting a parallel one.
- AC-4.4 A scheduled run SHALL do exactly what AC-4.1–4.3 describe; the button and the scheduler share one code path.
- AC-4.5 Collecting the same window twice SHALL produce no duplicate input items (idempotent on provider message id).

### US-5 Schedule rules

- AC-5.1 After sign-up THE SYSTEM SHALL have two default rules in the user's time zone: weekdays 09:00 → Work categories; Saturday and Sunday 09:00 → all other categories.
- AC-5.2 THE SYSTEM SHALL let a user add, edit, disable and delete rules (cron-like days + time + set of categories + time zone).
- AC-5.3 WHEN a rule fires THE SYSTEM SHALL start a collection run restricted to that rule's categories, within 5 minutes of the scheduled time.
- AC-5.4 WHEN a briefing is ready THE SYSTEM SHALL send a Web Push notification (short summary + briefing id, never the briefing body) to each subscribed device of that user, if the user enabled push; IF the push service answers 404 or 410 THEN THE SYSTEM SHALL delete that subscription.

### US-6 Briefing

- AC-6.1 Each briefing SHALL contain: (a) new input sorted by importance with a one-line reason per item, (b) deadlines calendar for the next 14 days from Todoist and calendars, (c) "must do today", (d) "needs updating" (overdue, stale, or contradicted by new input).
- AC-6.2 Every briefing entry SHALL link to its origin (message/task/event) and to the input item record.
- AC-6.3 THE SYSTEM SHALL keep briefing history; a user can open any past briefing.
- AC-6.4 IF the LLM call fails THEN THE SYSTEM SHALL still store the collected input and produce a degraded briefing (unranked, grouped by category) marked as such.

### US-7 Agent and knowledge base

- AC-7.1 Ranking, categorisation suggestions, routing to Todoist projects and "what next" advice SHALL be produced by one agent that uses the same application operations exposed via MCP.
- AC-7.2 THE SYSTEM SHALL let a user attach remote MCP servers (URL + auth) as knowledge bases; the agent SHALL be able to call their tools while ranking and advising.
- AC-7.3 THE SYSTEM SHALL record, per agent run, which tools were called, token usage and cost, visible to the user.
- AC-7.4 Text from input items SHALL be treated as data, never as instructions: an input item asking the agent to perform an action SHALL NOT cause that action (prompt-injection test suite).
- AC-7.5 WHILE a user has no own API key THE SYSTEM SHALL meter tokens against a per-user daily quota; IF the quota is exhausted THEN agent features SHALL degrade as in AC-6.4 and the UI SHALL say when the quota resets.
- AC-7.6 WHEN a user saves an own Anthropic API key THE SYSTEM SHALL verify it with a minimal API call, store it encrypted, and bill that user's agent runs to it without quota.

### US-8 "What next"

- AC-8.1 WHEN the user presses "What next" THE SYSTEM SHALL take the top item of the work queue, mark it "in progress", and show the agent's advice: what the task is, why it is next, concrete first steps, relevant context from input and knowledge bases.
- AC-8.2 THE SYSTEM SHALL let the user complete, postpone, or skip the current item; complete closes the Todoist task.
- AC-8.3 The work queue order SHALL be: urgent items first (US-9), then the briefing's "must do today", then by importance and deadline.

### US-9 Add a task

- AC-9.1 WHEN the user adds a task marked non-urgent THE SYSTEM SHALL store it as an input item and include it in the next briefing.
- AC-9.2 WHEN the user adds a task marked urgent THE SYSTEM SHALL place it at the head of the work queue so the next "What next" returns it.
- AC-9.3 Every new task SHALL be created in Todoist in the project whose routing rule (project description) best matches it; the agent SHALL state which rule it applied.
- AC-9.4 IF no project rule matches above the threshold THEN THE SYSTEM SHALL create the task in the category's default project (or Todoist Inbox) and flag it for review.

### US-10 Visualisation and statistics

- AC-10.1 THE SYSTEM SHALL show input volume per source, channel and category over day/week/month.
- AC-10.2 THE SYSTEM SHALL show importance distribution, response/handling time (input arrival → task done), queue throughput, and overdue trend.
- AC-10.3 The same statistics SHALL be available via API and MCP.

### US-11 Interfaces

- AC-11.1 Every operation in US-2…US-10 SHALL be available in the UI, the REST API (OpenAPI 3.1 published) and the MCP server (Streamable HTTP, OAuth 2.1).
- AC-11.2 THE SYSTEM SHALL expose an A2A agent (Agent Card at `/.well-known/agent-card.json`) offering skills: collect input, get briefing, what next, add task, query input.
- AC-11.3 THE SYSTEM SHALL ship an Agent Client Protocol agent (stdio, in the local bridge CLI) that proxies to the cloud core, so ACP clients (Zed, JetBrains, …) can chat with the secretary.
- AC-11.4 Each interface SHALL be covered by a contract test that runs the same scenario (collect → briefing → what next → add urgent task → what next returns it).

## 4. Non-functional requirements

- NFR-1 Security: secrets encrypted at rest with per-tenant keys; least-privilege provider scopes (read-only except Todoist write); CI runs dependency audit, SAST and secret scanning.
- NFR-2 Privacy: input bodies retained for a user-set period (default 30 days), then only metadata kept; GDPR export and delete.
- NFR-3 Accessibility: UI meets WCAG 2.2 AAA where applicable.
- NFR-4 Performance: UI LCP < 1.5 s on 4G; "What next" response < 3 s p95 (streamed); collection of 500 items < 2 min.
- NFR-5 Delivery: deploy only through CI/CD (GitHub Actions → Cloudflare); preview environments per PR.
- NFR-6 Stack: Astro + Lit UI (PWA), TypeScript everywhere; **bun is the only JS runtime locally and in CI, pinned to 1.4.5 or newer, no node** (owner, 2026-11-22); feature-based DDD layout.

## 5. Out of scope for v1

Sending replies on the user's behalf; Slack, Telegram, WhatsApp; native mobile apps; email/Discord delivery of briefings; billing.

## 6. Spec decomposition (each becomes its own requirements → design → tasks)

1. `01-tenancy-auth` — US-1
2. `02-connectors` — US-2 (one task group per provider) + local bridge
3. `03-categories` — US-3
4. `04-collection` — US-4, US-5
5. `05-agent-briefing` — US-6, US-7
6. `06-queue-tasks` — US-8, US-9
7. `07-stats` — US-10
8. `08-interfaces` — US-11 (REST, MCP, A2A, ACP)

## 7. Open questions (to the owner)

- Q1 Product name and domain (working name: Input Secretary).
