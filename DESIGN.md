# CREWReadiness — Design System

This documents the **existing** look and feel so design stays consistent as the
app grows. It's descriptive (codified from the current UI), not aspirational.
Deviations from this doc should be deliberate. Tooling: gstack `/design-review`
calibrates against this file.

## 1. Feel

A friendly, game-style training app for landscaping field crews — Duolingo's
DNA: encouraging, low-pressure, visual, and readable at a 6th-grade level.
Buttons feel physical ("pressable" with a thick bottom border that depresses on
click). Progress is celebrated (XP, confetti). Nothing is intimidating.

Two surfaces share one design language but differ in density:
- **Crew (learner):** gamified and spacious — big tap targets, mascot, one idea
  per screen, audio + image + text mixed for engagement.
- **Studio / Platform (owner, manager, platform):** the same components, denser
  and more utilitarian — content trees, review queues, settings.

## 2. Color

Surfaces and text use a slate base (shadcn CSS variables in `app/globals.css`).
Brand/semantic color lives in the **Button variants** (`components/ui/button.tsx`)
and status pills. Use color by MEANING, not decoration:

| Role | Color | Used for |
|------|-------|----------|
| Primary action / success | **green-500** (`secondary` button) | Create, Publish, Save, Start, correct |
| Info / navigate / AI | **sky-400/500** (`primary`, links) | primary CTAs, links, info banners, AI actions |
| Danger / wrong | **rose-500** (`danger`) | delete, wrong answer |
| "Super" / premium | **indigo-500** (`super`) | special/AI-course accents |
| Warning / in-progress | **amber-300/50** | Draft, parked-for-coaching |
| Neutral / disabled | **neutral-200/400** (`locked`) | locked, disabled |
| Text | **neutral-700** headings, **muted-foreground** (slate-500) secondary | — |

Avoid one-off hues (no violet/teal/etc.) — map to the table above. Dark-mode
variables exist in `globals.css` but the app ships light only.

## 3. Typography

Self-hosted **Nunito** variable font (latin + latin-ext for EN/ES), via
`next/font/local`. Rounded, friendly, highly legible.

| Token | Classes |
|-------|---------|
| Page title | `text-2xl lg:text-3xl font-bold text-neutral-700` |
| Lesson/question prompt | `text-lg lg:text-3xl font-bold text-neutral-700` |
| Section micro-label | `text-xs font-bold uppercase tracking-wide text-neutral-400` |
| Body | `text-sm`/`text-base font-medium` |
| Secondary / hint | `text-xs text-muted-foreground` |
| Button label | `text-sm font-bold uppercase tracking-wide` (from the Button base) |

Minimum readable size is **12px (`text-xs`)** — don't go below it.

## 4. Buttons (the signature element)

`components/ui/button.tsx` (cva). Shape: `rounded-xl`, bold uppercase label,
and a **thick bottom border** (`border-b-4`) that collapses on press
(`active:border-b-0`) for a tactile feel. Filled variants are chunky; `*Outline`
variants are flat white.

- `secondary` (green) — the default **primary action** (Create, Publish, Start).
- `primary` (sky) — secondary CTAs / info actions, and AI actions.
- `danger` (rose), `super` (indigo), `locked` (disabled), `ghost` (text-only).
- Sizes: `default` h-11, `sm` h-9, `lg` h-12, `icon`. Use `lg` for the main CTA
  on learner screens.
- Always use `<Button>` (with `asChild` for links) — never hand-roll a button.

## 5. Cards, surfaces, radii

- **Cards:** `rounded-2xl border-2 p-5/6`, white. Hover affordance on clickable
  cards: `hover:bg-slate-50`.
- **Nested blocks** (e.g. a lesson inside a unit): `rounded-xl bg-slate-50 p-3`.
- **Controls** (inputs, selects, textareas): `rounded-xl border-2 px-4 py-2`,
  `focus:border-green-500`.
- **Pills / badges:** `rounded-full px-2 py-0.5 text-xs font-bold` with a
  semantic bg/text pair (green/amber/rose/indigo + `-100`/`-700`).
- Radii rule of thumb: `rounded-2xl` cards, `rounded-xl` controls/nested,
  `rounded-full` pills.

## 6. Status & feedback

- **Pills:** Published = green, Draft = amber, Failed = rose, AI = indigo.
- **Toasts:** `sonner` — success (green check), error (red). Keep copy plain.
- **Celebration:** confetti + `/finish.svg` + points on lesson complete.
- **Mascot:** `/mascot.svg` (neutral/positive), `/mascot_bad.svg` (gentle "not
  quite"). The mascot teaches, never scolds.
- **Long jobs** (image/audio generation): show progress ("X/total done"), and a
  retry affordance for failures. Never leave a silent spinner.

## 7. Layout

- Left **sidebar** nav + main content; main pages use `px-4` with a header row
  (`flex flex-wrap items-center justify-between gap-x-4 gap-y-2`).
- Content max-widths: learner screens center at ~`max-w-[600px]`; forms at
  `max-w-xl`.
- Spacing rhythm: prefer the 4/8 scale (`gap-y-2/4`, `p-3/4/6`); keep it
  consistent within a view.

## 8. Imagery & icons

- Course/lesson art is **AI-generated** and served through the authed media
  proxy `/api/media/[id]` (never a hotlinked external URL). Images are rendered
  `unoptimized` (Next image optimizer can't carry the auth cookie) — fine
  because assets are icon/illustration sized.
- Default course image: `/mascot.svg`. Icons: lucide where used; otherwise
  inline SVG. Avoid decorative emoji in UI chrome.
- Generated illustrations: clean flat instructional style; realistic photos when
  a real scene helps. No text baked into images.

## 9. Motion

Subtle and functional: button press (border collapse), accordion expand
(`tailwindcss-animate`), confetti on completion. No gratuitous animation.

## 10. Accessibility

- **Tap targets ≥ ~40–44px** — pad icon-only controls (e.g. delete ×) and label
  them with `aria-label`.
- **Status is never color-only** — pair color with text ("failed", "Draft").
- `<audio>` voiceovers include a `<track>`; images have meaningful `alt`
  (the lesson title), decorative images use `alt=""`.
- Keep the `focus-visible` ring (in the Button base); don't remove outlines.

## 11. Voice & tone

Plain, concrete, encouraging. 6th-grade reading level. Job-site scenarios over
abstraction. Short sentences. "Not quite — here's why it matters" beats "Wrong."
Never blame the learner. Owner-facing copy is direct and practical.

## 12. Component inventory (canonical patterns)

- **Button** — `components/ui/button.tsx` (the system; use everywhere).
- **Course card** — image + title + lesson count + status pill (studio + learn).
- **Learn screen** — image + teaching text + tap-to-play voiceover → Start
  (`app/lesson/player.tsx`).
- **Challenge** — question prompt + 2–4 option cards (`app/lesson/challenge.tsx`).
- **Review list** — pending AI drafts with type badge + Approve/Reject
  (`app/(main)/studio/review/`).
- **Course editor** — module → unit → lesson tree with teaching/images/voiceover
  + inline add/delete (`app/(main)/studio/[courseId]/`).
- **AI Course Wizard** — hero idea field + collapsible optional details
  (`app/(main)/studio/ai-course-wizard.tsx`).
