# TODOS

Deferred work with full context. Added by /plan-eng-review 2026-06-12.

## 1. Email notification channel (Resend)

- **What:** Wire Resend email for owner events (review-queue drafts waiting, failed AI jobs) and assignment nudges. In-app stays primary; email becomes the delivery channel.
- **Why:** D24 chose in-app-only for launch. The outside voice flagged (F9) that owners won't discover pending drafts or failed voice jobs without a channel that reaches them where they already look — risk is the review queue becomes a content graveyard.
- **Pros:** One cheap dependency; directly lifts review-queue throughput and training-start rates; templates testable in CI.
- **Cons:** Deliverability setup (domain, SPF/DKIM); template maintenance.
- **Context:** All notifications land in the `notifications` table written by Inngest jobs and app events. Channel delivery hangs off the same writes — add a notification fan-out Inngest function that reads unsent rows and dispatches per channel. Start: `inngest/notify.ts` + Resend templates.
- **Depends on / blocked by:** P3 pipelines emitting notification rows.

## 2. Hard per-company AI budget caps with graceful degradation

- **What:** Enforce daily per-company AI budgets in `lib/ai/gateway.ts`; over cap → pre-generated variants + static explanations only (no live reteach/generation), with an owner-visible notice.
- **Why:** D25 chose alerts-only for launch. This captures the enforcement layer for when 2–4 weeks of real usage data exists to tune caps against. Until then, worst-case spend is bounded only by a human reacting to alerts.
- **Pros:** Bounds worst-case spend on the central provider key; degradation path (pre-gen content, static explanations) already exists by design (D7), so learning continues.
- **Cons:** Cap tuning per plan tier; a too-low cap silently dulls the AI teaching loop and needs monitoring to detect.
- **Context:** The gateway already meters every call per company (`ai_usage_events`, D5) and alerts platform owner at thresholds (D25). Enforcement is a budget check in the gateway before any live provider call. Start: `lib/ai/gateway.ts` budget guard + `provider_settings` cap columns.
- **Depends on / blocked by:** P3 gateway + P4 metering shipped; real usage data to set sane defaults.
