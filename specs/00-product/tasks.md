# Input Secretary — product tasks (phase 0 + spec order)

Status: **draft** (2026-11-22). Each capability spec (01…08) gets its own
requirements → design → tasks before its code; this file covers only the
foundation and the order.

## Phase 0 — foundation

- [ ] T0.1 Repository: public `igor-ganov/input-secretary`, `main` + `develop`, branch protection, specs committed. — NFR-5
  - The repository was republished as public with a clean history (2026-11-24) so that rulesets and CodeQL are available; rulesets on `main` and `develop` require a pull request and green `Lint, typecheck, unit` and `Web E2E (Playwright)`.
- [x] T0.2 bun workspaces monorepo: `apps/core`, `apps/web`, `apps/bridge`, `packages/contracts`, `packages/domain-kit`; strict `tsconfig`, Biome + eslint functional rules. Test: `bun run lint` and `bun run typecheck` pass on an empty feature. — NFR-6, design §2
- [x] T0.3 Test harness on bun only (`packageManager: bun@1.4.5`, `bun --bun`): Vitest with `@cloudflare/vitest-plugin` for core, Vitest for packages, Playwright for web, local Worker through Miniflare. Test: one failing-then-green smoke test per app. Notes: TypeScript stays on 6.0 because `typescript-eslint` and `@astrojs/check` do not support 7; package projects use the Vitest `threads` pool because `forks` fails under bun. — design §11
- [ ] T0.4 CI (GitHub Actions): lint, typecheck, unit, CodeQL, gitleaks, osv-scanner on every PR; preview deploy per PR and production deploy on `main` via `bun --bun wrangler` with a scoped Cloudflare API token created in the dashboard; the deploy step must be proven to run on bun without node. Test: PR shows all checks and a preview URL. — NFR-1, NFR-5
  - Done on `feature/phase-0`: `ci.yml` (lint, typecheck, unit), `security.yml` (gitleaks, osv-scanner, CodeQL). CodeQL runs only when the repo variable `CODEQL_ENABLED` is `true`, because a private repository needs GitHub Code Security.
  - Done: scoped token `input-secretary-ci-deploy` (Workers Scripts: Edit, Account Settings: Read) in the GitHub secret `CLOUDFLARE_API_TOKEN`; the `deploy` job in `ci.yml` runs on bun after lint, unit and E2E, then smoke-tests the target. `develop` deploys to `input-secretary-dev.igor-ganov.workers.dev`, a PR gets the alias `pr-<n>-input-secretary-dev.igor-ganov.workers.dev`.
  - Not done: the first production deploy from `main`. T0.4 stays open until it is green.
- [x] T0.5 Operation registry skeleton in `packages/contracts` + projection to REST (Hono) and MCP (Streamable HTTP) with one `health.echo` operation. Test: parity test calls echo through REST and MCP and gets identical output. — design §4, AC-11.1

## Phase 0 — spikes (results recorded in `specs/00-product/spikes.md`)

- [ ] S1 Teams delegated chat read: personal done (mail, calendar yes; Teams no), work tenant blocked on admin consent. — design §12, AC-2.1, AC-2.6
- [ ] S2 Yahoo: blocked until the product has a domain + privacy policy and Yahoo approves OAuth access. — design §5, AC-2.2
- [x] S3 Web Push from workerd to Chrome and Firefox, rerun on bun 1.4.5 only. — AC-5.4
- [x] S4 Pin A2A v1.0 and `@agentclientprotocol/sdk` versions; hello-world agent card and ACP echo agent. — AC-11.2, AC-11.3

## Capability specs, in order

| Order | Spec | Depends on | Covers |
|-------|------|------------|--------|
| 1 | `01-tenancy-auth` | T0.* | US-1, design §9 |
| 2 | `03-categories` | 01 | US-3 (needs Todoist connector for binding → minimal Todoist OAuth in this spec) |
| 3 | `02-connectors` (Todoist, Outlook, Gmail first; Teams, Discord, Yahoo after spikes) | 01, S1, S2 | US-2 |
| 4 | `04-collection` | 02, 03 | US-4, US-5 |
| 5 | `05-agent-briefing` | 04 | US-6, US-7 |
| 6 | `06-queue-tasks` | 05 | US-8, US-9 |
| 7 | `07-stats` | 04 | US-10 |
| 8 | `08-interfaces` (A2A, ACP; REST/MCP grow with each spec) | 01, S4 | US-11 |
| 9 | Bridge: Proton | 02, 08 | US-2 Proton |

Done for the product = every AC in `requirements.md` linked to a green test in CI, and the parity scenario (AC-11.4) green on all four interfaces.
