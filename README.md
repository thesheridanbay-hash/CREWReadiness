# CREWReadiness

AI-powered employee training and onboarding for landscaping companies. Field crews complete short, game-style lessons with a teaching loop that makes sure they understand concepts before they hit the job site.

Built on the [duolingo-clone](https://github.com/sanidhyy/duolingo-clone) learning UX, reshaped for multi-tenant company training: courses, assignments, voice/photo-to-training, weak-concept reporting, and a swappable AI gateway (OpenClaw today, direct API later).

## Status

**Live**: [crew-readiness.vercel.app](https://crew-readiness.vercel.app) — T1–T7 foundation complete (multi-tenant RLS, auth, learning-loop machine, AI gateway + pipelines, test infra). Database: Neon Postgres with FORCE RLS, fail-closed tenant isolation verified in production. Next: P1 employee experience (T8), P2 owner content studio (T10).

## Docs

- [PLAN.md](./PLAN.md) — architecture, locked decisions, phases, implementation tasks
- [TODOS.md](./TODOS.md) — deferred follow-ups (email notifications, AI budget caps)

## Stack (planned)

Next.js 16, React 19, TypeScript, Better Auth, Drizzle + Neon Postgres (RLS), Inngest, Vercel Blob, Vitest + Playwright.

## Development

Requires [gstack](https://github.com/garrytan/gstack) for AI-assisted workflows in this repo. See [CLAUDE.md](./CLAUDE.md).
