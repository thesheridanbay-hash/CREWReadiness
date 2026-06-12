# CREWReadiness — Product & Engineering Plan

AI-powered employee training and onboarding for landscaping companies. Owners turn
knowledge, SOPs, voice notes, and field-mistake photos into short, game-style training
that field employees actually complete and understand. Built as a real product
foundation, not an MVP shortcut.

Base: [duolingo-clone](https://github.com/sanidhyy/duolingo-clone) (Next.js 16 / React 19 /
TS 6 / Drizzle / Neon / Tailwind + shadcn). Employee-facing learning UX is reused; auth,
admin, payments, and gamification economy are replaced.

---

## 1. Locked decisions (eng review 2026-06-12)

| # | Decision | Choice |
|---|----------|--------|
| D3/D11 | Auth + multi-tenancy | Better Auth + organization plugin on Neon/Drizzle. Company = organization; roles: platform owner, company owner/admin, manager, employee |
| D4/D11 | Employee identity | Invite link + username/PIN login (no email required). Hardened: per-account + per-IP rate limits, lockout, manager-initiated PIN reset, short idle session for employee role, explicit user-switch UX for shared crew phones |
| D5 | AI provider boundary | `lib/ai` gateway. Adapters: OpenClaw (current "mule" via public MCP fixed IP) and direct API (OpenAI/Claude/Gemini/OpenRouter). Admin-panel toggle + encrypted key storage. App code never imports a provider directly |
| D6 | Media→training pipeline | Inngest background jobs + owner review queue. AI *drafts* are never auto-published. (Live reteach/variants are runtime-guarded instead — see D19/AI subsystem) |
| D7 | Teaching loop content | Hybrid: pre-generated variant bank per question + live streamed reteach. Timeout or budget-stop → fall back to pre-generated variant |
| D8 | Admin UI | Native Next.js owner area (drop react-admin). shadcn/ui + Vercel SaaS starter patterns |
| D9/D12 | Media storage | Vercel Blob, client-side direct uploads. EXIF stripped at upload; private access via authed proxy/signed URLs (field photos are sensitive: faces, customer properties, GPS) |
| D10 | Gamification | Strip hearts/shop/Stripe. Keep points + streaks. Wrong answers never *brick the session* — they route into the learning loop (see D23 for the terminal state) |
| D13 | Memory-improvement loop | Full loop in core: Capture → Distill → Verify → Deploy → Measure → Decay/Correct, incl. decay jobs and bilingual (EN/ES) content |
| D14 | Tenant scoping | Scoped query layer (`lib/db/scoped.ts`) + Postgres RLS. **Fail-closed setup:** separate non-owner runtime DB role (migrations role ≠ app role), `FORCE ROW LEVEL SECURITY` on every tenant table, CI test asserting the runtime role lacks BYPASSRLS |
| D15 | Error contract | Typed result envelope + zod validation at every boundary + Sentry |
| D16 | Content CRUD | Hand-written actions per level (course/module/unit/lesson/question). Shared zod schemas; no generic factory |
| D17 | Learning loop | Pure state machine module (`lib/learning-loop/machine.ts`), UI-independent, exhaustively tested. Sessions pin to a contentVersion at start |
| D18 | Test stack | Vitest (unit/integration) + Playwright (E2E) + real Postgres (Neon test branch) for RLS isolation tests. RLS + server-action matrices are table-driven generators, not hand-written one-offs |
| D19 | AI evals | 6 CI-gated suites (~70 golden cases): text-gen, photo-gen, reteach, variant-gen, Spanish quality, **prompt-injection/adversarial**. Plus a runtime answer-leakage guard before streaming reteach tokens |
| D20 | RLS mechanics | Transaction-wrapped `SET LOCAL app.company_id` inside the scoped layer. Requires the Neon **WebSocket Pool driver** (HTTP driver can't do interactive transactions). Jobs use `scopedForJob()` resolving companyId from a DB-verified `ai_jobs` row — never from event payloads |
| D21 | Reporting | Live SQL aggregates with purpose-built indexes (no rollup counters, no nightly batch) |
| D22 | Learn page | Course outline first + per-unit lazy fetch; published content cached by content-version |
| D23 | Loop terminal state | **Park-and-continue:** after N failed reteach cycles, concept is parked as "needs in-person coaching," manager flagged, employee advances to next lesson. Course stays incomplete until the manager resolves the parked concept. Reteach calls capped per question per day |
| D24 | Notifications | In-app only for launch (badge counts + notifications page). Email channel (Resend) captured in TODOS.md as the follow-up |
| D25 | AI cost control | Metering + platform-owner alerts at thresholds. No hard enforcement at launch; per-company budget caps captured in TODOS.md |

## 2. System architecture

```
                ┌──────────────────────────── Vercel ────────────────────────────┐
                │                                                                │
 Employee 📱 ──▶│  Next.js App Router                                            │
 Owner 💻   ──▶│  ├── (employee)/  lesson player, course map, progress           │
 Manager 💻 ──▶│  ├── (owner)/     content studio, review queue, reports, usage  │
 Platform 💻──▶│  ├── (platform)/  cross-company usage, provider toggle, alerts  │
                │  └── api/inngest  job handlers                                 │
                │        │                                                       │
                │  Better Auth (org plugin) ── session hook injects              │
                │        │            {userId, companyId, role} (custom claims)  │
                │  lib/db/scoped.ts ── BEGIN; SET LOCAL app.company_id; query    │
                │   ├─ scoped(session)    (requests)         ▲                   │
                │   └─ scopedForJob(jobRow) (Inngest)        │ FORCE RLS,        │
                │        ▼                                   │ non-owner role    │
                │  Neon Postgres (Drizzle, WS Pool driver) ──┘ enforces at DB    │
                │                                                                │
                │  lib/ai/ gateway ──┬── OpenClawAdapter (MCP fixed IP, today)   │
                │   metering+alerts  └── DirectAPIAdapter (admin toggle, later)  │
                │   answer-leak guard on reteach streams                         │
                │        │                                                       │
                │  Inngest ── voice→lesson, photo→lesson, text→lesson,           │
                │   (all side effects inside step.run)  variant pre-gen,         │
                │   decay jobs, DLQ→notifications                                │
                │                                                                │
                │  Vercel Blob ── photos/videos/voice (EXIF-stripped, authed     │
                │                 access, client upload)                         │
                │  Sentry ── error envelope capture                              │
                └────────────────────────────────────────────────────────────────┘
```

## 3. Data model (module level)

Every tenant table carries `companyId` + RLS policy (`FORCE ROW LEVEL SECURITY`).
Content hierarchy: `courses → modules → units → lessons → questions →
question_options`, plus `question_variants` (pre-generated retest bank, regenerated on
publish), `content_versions` (sessions pin to one), `attempts` (append-only answer log
feeding reports), `parked_concepts` (D23 manager-resolution queue), `assignments`
(employee/crew × course), `crews`, `crew_members`, `tags` + `lesson_tags` (reusable
manual), `media_assets`, `ai_jobs` (tenant anchor for `scopedForJob`),
`ai_usage_events` (per-company metering), `review_queue`, `notifications`,
`provider_settings` (encrypted keys + alert thresholds, platform-scope only).

## 4. Learning loop (the product) — pure state machine

```
                    ┌─────────┐
        answer ──▶  │ QUESTION │ ◀──────────────────────────────┐
                    └────┬────┘                                 │
              correct?   │                                      │
            ┌── yes ─────┴───── no ──┐                          │
            ▼                        ▼                          │
       ┌─────────┐            ┌──────────────┐                  │
       │ ADVANCE │            │ EXPLAIN       │ static "why"    │
       │ +points │            │ (attempt 1)   │ from lesson     │
       └────┬────┘            └──────┬───────┘                  │
            │                        │ retry same question      │
            │              correct?  │                          │
            │        ┌── yes ────────┴──── no ──┐               │
            │        ▼                          ▼               │
            │   ┌─────────┐            ┌─────────────────┐      │
            │   │ ADVANCE │            │ AI RETEACH       │     │
            │   │ + weak-  │           │ simpler angle,   │     │
            │   │ concept  │           │ streamed, runtime│     │
            │   │ event    │           │ answer-leak guard│     │
            │   └────┬────┘            └────────┬────────┘      │
            │        │                          │ serve variant (pre-gen bank;
            │        │                          │ live-gen fallback if exhausted;
            │        │                          └─ cycle < N ───┘ timeout → pre-gen)
            │        │                          │
            │        │                          │ cycle ≥ N (cap)
            │        │                          ▼
            │        │                 ┌──────────────────────┐
            │        │                 │ CONCEPT_PARKED (D23)  │──▶ manager flag +
            │        │                 │ employee advances to  │    resolve flow;
            │        │                 │ next lesson           │    course incomplete
            │        │                 └──────────────────────┘    until resolved
            ▼        ▼
       ┌──────────────────┐
       │ SESSION_COMPLETE │  (also: ABANDONED via idle expiry — resume-safe)
       └──────────────────┘
   All transitions persisted (resume-safe; double-submit idempotent; one active
   session per user+lesson). Sessions pinned to contentVersion at start — publish
   mid-session never corrupts state; migration rule: finish on pinned version.
   Illegal transitions → typed error → reset offer. Reteach calls capped/question/day.
```

## 5. AI subsystem

- **Gateway (`lib/ai`)**: one interface — `generateLesson`, `generateQuiz`, `reteach`,
  `generateVariants`, `analyzePhoto`, `transcribeVoice`. Every call wrapped with
  per-company usage metering, threshold alerts (D25), and the D15 error envelope.
  Zod-validated outputs; invalid JSON → retry once → dead-letter + owner notification.
- **Prompt-injection posture**: owner-supplied text/transcripts/photo-text is
  delimited/sandwiched in prompts; reteach streams pass a runtime answer-leakage check
  before tokens reach the client; injection eval suite gates prompt changes (D19).
- **Pipelines (Inngest)**: text→training, voice→training (transcription via OpenClaw),
  photo→training (wrong-way/right-way pairs). All side effects inside `step.run`
  (re-execution-safe); tenant context via `scopedForJob()`; all drafts land in the
  review queue.
- **Memory-improvement loop (D13)**: Capture (field mistakes, weak-concept events,
  parked concepts) → Distill (draft lessons) → Verify (owner review queue) → Deploy
  (publish + assign + variant regeneration) → Measure (attempt outcomes by tag) →
  Decay/Correct (scheduled refresh + retraining triggers).
- **Evals (D19)**: 6 CI-gated suites — text-gen, photo-gen, reteach (simpler reading
  level + no answer leakage), variant-gen (same concept, new surface), Spanish quality,
  prompt-injection/adversarial.

## 6. Phases

- **P0 Foundation**: bootstrap from clone; strip Clerk/Stripe/react-admin/hearts/shop;
  Better Auth + org plugin (incl. timeboxed spike proving org-scoped username+PIN —
  fallback: separate employee credential table); schema + FORCE RLS + non-owner runtime
  role + WS-driver scoped layer + `scopedForJob`; error envelope + Sentry; test infra
  (Vitest/Playwright/Neon branch, table-driven RLS/action generators) + CI; Inngest +
  Blob wiring (EXIF strip + authed access); freeze `lib/learning-loop/types.ts`
  contract incl. D23 states.
- **P1 Employee experience**: reshape lesson player onto the state machine (incl.
  CONCEPT_PARKED + SESSION_COMPLETE UX); assignments, progress, points/streaks;
  outline + per-unit lazy learn page (D22) with contentVersion pinning; EN/ES toggle.
- **P2 Owner content studio**: hand-written course-tree CRUD (D16) with publish →
  content-version bump + variant regeneration; tags + reusable manual library; media
  uploads; review queue UI; parked-concept resolve flow (manager).
- **P3 AI pipeline**: gateway + adapters + admin toggle + metering/alerts; text/voice/
  photo→training jobs; variant pre-generation; live reteach streaming with leak guard;
  eval harness (6 suites).
- **P4 Reporting + usage**: weak-concept reports per employee/crew/tag (D21);
  per-company AI usage area; platform-owner cross-company view + alert thresholds.
- **P5 Memory loop completion**: decay jobs, retraining triggers, trainee-generated
  scenarios, bilingual image-pair generation.

## 7. Test strategy

Artifact: `~/.gstack/projects/CREWReadiness/hassan-master-eng-review-test-plan-20260612-163838.md`
(consumed by /qa). Baseline 0% (clone has no tests). Targets: 100% state-machine
transition coverage (incl. D23 states, double-submit, two-device, resume-after-publish);
RLS isolation for every tenant table via table-driven generator, run as request path
AND as Inngest path (CI-blocking); runtime-role-lacks-BYPASSRLS assertion; every server
action ≥ success + auth-failure + validation-failure via action-matrix generator; PIN
brute-force/lockout/reset tests; cross-tenant Blob access test; Inngest step
re-execution semantics; 9 E2E flows; 6 eval suites incl. injection. Regression rule:
stripping hearts rewires the lesson player — employee-flow E2E ships inside P1.

## 8. What already exists (clone reuse map)

| Clone asset | Verdict |
|---|---|
| Lesson player UI (`app/lesson/*` — quiz shell, cards, footer, result screens) | **Reuse**, rewire onto state machine |
| Learn page UI (unit map, lesson buttons, sticky sidebars) | **Reuse**, feed from lazy per-unit queries |
| Drizzle + Neon setup, Tailwind/shadcn config, app-router layout structure | **Reuse** (switch Neon HTTP driver → WS Pool driver for transactions) |
| `db/schema.ts` | **Extend heavily**: tenancy, hierarchy (modules), variants, versions, attempts, assignments, tags, parked concepts |
| `db/queries.ts` | **Replace** with scoped layer (D14/D20) + outline/unit queries (D22) |
| `actions/*` (hearts, shop logic) | **Replace**: typed envelopes, no hearts |
| Clerk auth, Stripe, react-admin, marketing pages | **Remove** |

## 9. NOT in scope (considered, deferred)

- **Email notification channel (Resend)** — D24 chose in-app only for launch; email is captured in TODOS.md with full context.
- **Hard per-company AI budget caps** — D25 chose metering + alerts; enforcement layer captured in TODOS.md, tuned on real usage data.
- **SMS nudges for employees (Twilio)** — highest-reach channel but cost + TCPA opt-in burden; revisit after email channel lands (user: skip for now).
- **Offline-first PWA / answer queue** — P1 ships retry UI for flaky signal; true offline sync deferred (user: skip for now).
- **Customer-supplied AI keys (BYO key per company)** — single central provider config now; per-company keys later.
- **Native mobile apps** — responsive web first; the clone UX is already mobile-shaped.
- **Billing/subscriptions** — Stripe removed; pricing comes after the core proves value.
- **SSO/SCIM for enterprise** — Better Auth invite flows cover target customers (5–50 employees).
- **Cross-company content marketplace** — manual stays company-private.
- **Materialized cross-company rollups** — platform dashboard uses live per-company aggregates (D21); revisit at scale.
- **Auto-publish of AI drafts** — review queue is mandatory by design (D6), not a gap.
- **Codex CLI cross-model reviews** — not installed on this machine; outside voice ran via Claude subagent. Install: `npm install -g @openai/codex`.

## 10. Failure modes (per new codepath)

| Codepath | Realistic failure | Test? | Handled? | User sees |
|---|---|---|---|---|
| scoped.ts + RLS | Missing SET LOCAL on owner-role connection → **all tenants' rows** (fail-open) | Runtime-role BYPASSRLS assertion + raw-connection isolation tests | Non-owner runtime role + FORCE RLS + scoped() throws without company ctx | Typed error page, never silent or cross-tenant |
| Inngest jobs | No session context → privileged writes or payload-trusted tenant identity | Isolation tests run *as the job path* | `scopedForJob()` resolves companyId from DB-verified `ai_jobs` row | n/a (internal); job fails closed |
| Inngest re-execution | Handler code outside `step.run` re-runs every step | Step re-entry tests | Convention + lint: all side effects inside steps; idempotency keys | No duplicate lessons/notifications |
| Learning loop resume | Two devices / double-submit / corrupted state | Transition-table + concurrency tests | One active session per user+lesson; idempotent answer writes; typed error → reset offer | "Pick up where you left off" |
| Publish mid-session | Question archived while employee mid-loop | Resume-after-publish test | Sessions pinned to contentVersion; finish on pinned version | No lost progress |
| AI reteach | Provider timeout mid-stream; answer leaked in output | Gateway timeout test + leak-guard unit test + injection evals | Fallback to pre-gen variant (D7); runtime leak guard blocks stream | Variant question, no stall, no leaked answers |
| Voice pipeline | Transcription fails | Inngest harness test | Retry → DLQ → owner notification | "Voice note failed, retry" card |
| Photo pipeline | AI returns invalid JSON; injected instructions in photo text | Zod-reject test + injection evals | Retry once → DLQ + notification; delimited prompts | Failed-job card with retry |
| Blob | Leaked URL → cross-tenant/public access to sensitive photos; GPS EXIF | Cross-tenant fetch test; EXIF-strip test | Authed proxy/signed access; EXIF stripped at upload | Photos only render for authed company members |
| Employee PIN auth | Online brute-force; shared-phone session bleed | Brute-force + lockout + reset tests | Rate limits, lockout, manager PIN reset, short idle session, user-switch UX | Lockout message + "ask your manager" |
| Usage metering | Metering write fails after AI success | Integration test | Metering in same Inngest step, retried | n/a (internal; undercount only) |
| Assignments | Two managers assign same crew concurrently | Idempotent-upsert test | Unique constraint + upsert | Single assignment, no dupes |

**Critical gaps: 0** — after folding outside-voice findings F1–F8, every identified
mode has a planned test, handling, and a visible (or fail-closed) outcome. The three
risks the original table missed (job-context tenancy, Blob leakage, PIN abuse) are now
rows above.

## 11. Worktree parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| P0 Foundation | db/, lib/db/, lib/auth/, lib/errors/, lib/learning-loop/types.ts, ci | — |
| P1 Employee | app/(employee)/, lib/learning-loop/ | P0 |
| P2 Owner studio | app/(owner)/, actions/content/ | P0 |
| P3a AI gateway+jobs | lib/ai/, inngest/ | P0 |
| P3b Review queue UI | app/(owner)/review/ | P2, P3a |
| P4 Reporting+usage | app/(owner)/reports/, app/(platform)/ | P0 (schema), P1 (attempt data) |
| P5 Memory loop | inngest/, lib/ai/ | P3, P4 |

Lanes after P0 merges: **Lane A** P1 · **Lane B** P2 · **Lane C** P3a — launch in
parallel worktrees. Merge all three → P3b + P4 (parallel) → P5.
Conflict flags: A+B share `components/ui` (shadcn primitives — low risk); A+C share the
machine↔variant interface — frozen in P0 (`lib/learning-loop/types.ts`, incl. D23
states). P2's parked-concept resolve flow consumes Lane A's `parked_concepts` writes —
schema frozen in P0, so no code conflict.

## 12. Implementation Tasks

Synthesized from this review's findings (T1–T10 from sections 1–4; T11–T16 from
outside-voice findings the user accepted). Phase labels match Section 6. Run with
Claude Code; checkbox as you ship.

- [ ] **T1 (P0, human: ~3d / CC: ~45min)** — db — Schema with companyId everywhere + FORCE RLS + non-owner runtime role + WS-driver scoped layer (`SET LOCAL`) + `scopedForJob()`
  - Surfaced by: Code quality D14 + Performance D20 + Outside voice F1/F2
  - Files: db/schema.ts, db/rls.sql, lib/db/scoped.ts, drizzle.config.ts
  - Verify: table-driven isolation tests (request + job paths); BYPASSRLS assertion
- [ ] **T2 (P0, human: ~4d / CC: ~1h)** — auth — Better Auth + org plugin; session claims hook; employee invite-link + PIN with rate-limit/lockout/manager-reset/idle-session/user-switch; timeboxed spike proving org-scoped username+PIN (fallback: separate employee credential table)
  - Surfaced by: Architecture D11 + Outside voice F6/F7
  - Files: lib/auth/, app/(auth)/, middleware.ts
  - Verify: Playwright RBAC matrix + brute-force/lockout tests; spike exit report
- [ ] **T3 (P0→P1, human: ~3d / CC: ~45min)** — learning-loop — Pure state machine: full transition table incl. CONCEPT_PARKED + SESSION_COMPLETE + ABANDONED; contentVersion pinning; idempotent double-submit; one-active-session rule; reteach cap
  - Surfaced by: Code quality D17 + Outside voice F3/F4 + decision D23
  - Files: lib/learning-loop/{machine,types}.ts
  - Verify: 100% transition coverage incl. concurrency + resume-after-publish
- [ ] **T4 (P3, human: ~3d / CC: ~45min)** — ai — Gateway + OpenClaw/direct adapters + admin toggle + per-company metering + threshold alerts + timeout fallback + runtime answer-leak guard + delimited prompts
  - Surfaced by: Architecture D5 + Outside voice F5 + decision D25
  - Files: lib/ai/{gateway,adapters,meter,guard}.ts, app/(platform)/settings/
  - Verify: integration tests incl. provider-switch + leak-guard; injection evals
- [ ] **T5 (P0, human: ~2w / CC: ~3h)** — testing — Vitest + Playwright + Neon-branch CI; table-driven RLS + action-matrix generators; 6 eval suites (~70 goldens, Spanish goldens human-authored); PIN-abuse, Blob cross-tenant, step re-entry classes
  - Surfaced by: Test review D18/D19 + Outside voice F11
  - Files: vitest.config.ts, playwright.config.ts, evals/, tests/generators/, .github/workflows/
  - Verify: CI green; prompt-diff triggers eval gate
- [ ] **T6 (P3, human: ~3d / CC: ~45min)** — pipelines — Inngest voice/photo/text→training with all side effects in steps, retries, idempotency, DLQ→notifications; variant regeneration on publish
  - Surfaced by: Architecture D6 + Outside voice F2/F4
  - Files: inngest/, actions/publish.ts
  - Verify: harness tests for retry/idempotency/re-entry/DLQ
- [ ] **T7 (P0, human: ~1d / CC: ~20min)** — errors — Typed envelope + zod boundaries + Sentry wiring
  - Surfaced by: Code quality D15
  - Files: lib/errors/, instrumentation.ts
  - Verify: unit tests; Sentry captures `unexpected` class only
- [ ] **T8 (P1, human: ~2d / CC: ~30min)** — employee-ui — Outline + per-unit lazy learn page with contentVersion caching; parked-concept + completion UX
  - Surfaced by: Performance D22 + decision D23
  - Files: app/(employee)/learn/, lib/db/queries/units.ts
  - Verify: E2E + payload assertion on large-course fixture
- [ ] **T9 (P4, human: ~1d / CC: ~20min)** — reporting — Live SQL aggregates + indexes for weak-concept reports and usage
  - Surfaced by: Performance D21
  - Files: lib/db/queries/reports.ts, db/indexes
  - Verify: integration tests with seeded attempts; EXPLAIN uses indexes
- [ ] **T10 (P2, human: ~3d / CC: ~45min)** — content-crud — Hand-written CRUD per hierarchy level with shared zod schemas + tags/manual library + publish→version-bump
  - Surfaced by: Code quality D16 + Outside voice F4
  - Files: actions/content/{course,module,unit,lesson,question}.ts
  - Verify: per-level success/auth-fail/validation-fail via action-matrix generator
- [ ] **T11 (P0, human: ~1d / CC: ~20min)** — media — Blob upload tokens with role/size/type limits + EXIF strip + authed access route
  - Surfaced by: Outside voice F8
  - Files: app/api/media/, lib/media/
  - Verify: cross-tenant fetch test + EXIF-strip test
- [ ] **T12 (P2, human: ~1d / CC: ~20min)** — manager-flow — Parked-concept resolve UI (manager marks coached → concept re-queued for retest)
  - Surfaced by: Outside voice F3 + decision D23
  - Files: app/(owner)/coaching/, actions/parked.ts
  - Verify: E2E: park → manager resolve → retest → course completes
- [ ] **T13 (P4, human: ~0.5d / CC: ~15min)** — alerts — Platform-owner AI usage threshold alerts (in-app)
  - Surfaced by: Outside voice F10 + decision D25
  - Files: inngest/usage-alerts.ts, app/(platform)/usage/
  - Verify: integration test crossing threshold emits alert row

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | (Codex CLI not installed) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAN (PLAN) | 23 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CROSS-MODEL:** Outside voice (Claude subagent, fresh context) returned 12 findings, 6 HIGH — verdict SHIP WITH FIXES. 9 absorbed as plan fixes (fail-closed RLS, scopedForJob, version pinning, injection guard, PIN hardening, Better Auth spike, Blob privacy, test generators, plan hygiene); 3 escalated to user decisions D23–D25 (park-and-continue terminal state; in-app-only notifications; alerts-only cost control).
- **VERDICT:** ENG CLEARED — 23 decisions locked (D3–D25), 0 critical gaps, ready to implement P0.

NO UNRESOLVED DECISIONS
