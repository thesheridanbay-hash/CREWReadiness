# SonarCoach — Design System (cross-brand with CrewYield)

**Status: target system.** SonarCoach and **CrewYield** are the same parent
company on separate domains and separate backends. They share ONE visual brand
family so an owner who moves between them feels continuity, not a brand-new app.
This doc defines that shared family for SonarCoach. The current code still ships
the legacy green/sky/teal palette; §13 is the visual-only migration that gets us
here. **Nothing in this re-skin touches backend, routes, data, or logic.**

gstack `/design-review` calibrates against this file.

---

## 0. Brand family — what's shared vs distinct

Two products, one company, one palette:

- **CrewYield** — crew-day profitability ("the field ledger"): serious, money-as-
  scoreboard, Fraunces serif + IBM Plex Mono numbers, denser, tighter radii.
- **SonarCoach** — AI training: playful, gamified (Duolingo DNA), Nunito rounded,
  chunky pressable buttons, confetti, mascot.

**SHARED across both (this is the family signal):**
- The **color palette** — warm cream canvas, deep pine structure, a single gold
  accent, green/red strictly semantic.
- The **gold-accent discipline** — gold is the *only* accent and appears **once
  per view** (the primary action). No second accent competing for attention.
- The **anti-slop rules** (§12) — no SaaS-blue/Inter/purple-gradient/rainbow look.

**DISTINCT (each keeps the personality its job needs):**
- SonarCoach stays **rounded, chunky, celebratory** (Nunito, `rounded-2xl`,
  `border-b-4` pressable buttons, confetti). CrewYield stays editorial/ledger.
- Same colors, different energy — like two products from one company, not clones.

---

## 1. Feel

A friendly, game-style training app for landscaping field crews — Duolingo's DNA:
encouraging, low-pressure, visual, readable at a 6th-grade level. Buttons feel
physical (thick bottom border that depresses on click). Progress is celebrated
(XP, confetti). Nothing is intimidating. Two surfaces share one design language,
differing only in density:
- **Crew (learner):** gamified and spacious — big tap targets, mascot, one idea
  per screen, audio + image + text mixed for engagement.
- **Studio / Platform (owner, manager, platform):** the same components, denser
  and more utilitarian — content trees, review queues, settings.

Both surfaces use the **same token set** (§2). There is no separate owner palette.

---

## 2. Color — the CrewYield family palette

Color is used by **MEANING, not decoration**. The palette is CrewYield's,
expressed as SonarCoach semantic tokens. All values are literal (warm, ink-tinted
neutrals — never pure white/black/cold-gray).

### Core tokens

| Token | Hex | Role |
|---|---|---|
| `canvas` | `#f6f4ec` | App/page background (warm cream). Replaces white. |
| `canvas-2` | `#efece1` | Recessed surfaces, nested-block fills, table footers |
| `surface` | `#fffdf7` | Cards, inputs, popovers (near-white warm) |
| `ink` | `#16201a` | Primary text/headings (green-tinted near-black) |
| `ink-2` | `#3f4a42` | Secondary text |
| `ink-3` | `#6b756c` | Muted text, micro-labels, captions |
| `line` | `#ddd7c7` | Hairlines / borders (warm tan) |
| `line-2` | `#cbc4b0` | Stronger borders, input borders |
| **`brand`** | **`#1f4131`** (pine) | **Brand chrome** — sidebar, mobile header, wordmark, headings, primary-structure surfaces |
| `brand-ink` | `#0f2419` | Deepest pine — text on light, headers, on-pine contrast |
| `brand-2` | `#2c5a43` | Pine hover / lighter pine |
| `brand-soft` | `#e7efe7` | Soft pine fill — row hover, info callouts, active-tint |
| **`accent`** | **`#c8881f`** (gold) | **The single accent** — primary CTA per screen, active nav, AI-magic, streaks/rewards, focus outline |
| `accent-soft` | `#f6ebd3` | Gold tint — chips, draft/in-progress pills, AI pills |
| `accent-ink` | `#9a6710` | Dark gold — AA text on `accent-soft` |
| `success` | `#2f7d4f` | Correct answer, progress, "go/done", published |
| `success-soft` | `#e3f0e6` | Success tint background |
| `danger` | `#b23a2d` | Wrong answer, delete, failed |
| `danger-soft` | `#f6e1dc` | Danger tint background |
| `info` | `#3a5a8c` | RARE — plain informational only, never a brand color |

**Dominant trio that defines the family:** pine `#1f4131` · cream `#f6f4ec` ·
gold `#c8881f`. If a screen reads as "pine + cream + one gold thing," it's on-brand.

### Derived ramps (for shades — from CrewYield's Shoelace theme)
- **Pine (`brand`):** 50 `#e7efe7` · 100 `#cfddcf` · 200 `#a0bba0` · 300 `#6a9a73`
  · 400 `#4a7958` · 500 `#2c5a43` · 600 `#1f4131` · 700 `#16321e` · 800 `#0f2419`
  · 900 `#0c1d14`
- **Gold (`accent`):** 50 `#f6ebd3` · 500 `#c8881f` · 700 `#9a6710`
- **Success:** 50 `#e3f0e6` · 500 `#2f7d4f` · **Danger:** 50 `#f6e1dc` · 500 `#b23a2d`
- **Neutral (cream→ink):** 50 `#fffdf7` · 100 `#f6f4ec` · 200 `#efece1` · 300
  `#ddd7c7` · 400 `#cbc4b0` · 600 `#6b756c` · 700 `#3f4a42` · 900 `#16201a`

### Migration map (legacy → new) — what every old hue becomes

| Legacy (today) | New token | Notes |
|---|---|---|
| white background | `canvas` (cream) | warmer base |
| `green-500` *as primary CTA* (Button `secondary`) | **`accent`** (gold) | the main action per screen becomes gold (the family signal) |
| `green-500` *as success/correct/progress* | `success` | keep "green = right"; warmer green |
| `sky-400/500` (primary, links, info) | **`accent`** for AI/CTA, `info` for plain links | de-rainbow: drop sky |
| `indigo-500` ("super"/AI) | **`accent`** (gold) | AI = the special thing = gold; drop indigo |
| `amber-300/50` (draft/warning) | `accent-soft` / `accent-ink` | warn folds into gold |
| `rose-500` (danger/wrong) | `danger` | warmer red |
| `teal-600`/`green-600` (wordmark) | `brand` + `accent` | pine + gold (see §wordmark) |
| `neutral-700` text | `ink` | |
| slate borders | `line` | |

**Result:** the whole app reduces to **pine + gold + green + red + warm neutrals**
(plus a rare info-blue). No teal, indigo, sky, amber, or violet. One accent per view.

> **The one judgement call to confirm:** in training UX, *green often reads as the
> "go" button.* This system makes the **primary action gold** (CrewYield's move)
> and keeps **green for correctness/progress**. That maximizes brand continuity. If
> you'd rather keep green CTAs and use gold only for rewards/streaks/AI, that's the
> single fork — say which and the token map flips trivially.

---

## 3. Typography

Keep self-hosted **Nunito** (variable, latin + latin-ext for EN/ES) via
`next/font/local`. Rounded, friendly, legible — it is part of SonarCoach's
*distinct* personality and is **not** changed by the re-skin. (CrewYield's
Fraunces serif + IBM Plex Mono are CrewYield's; we do not adopt them — different
products, different voices, same colors.)

*Optional family echo (low priority):* render **numerals** (XP, scores, streak
days, timers) in a tabular mono to nod at CrewYield's "numbers are special" — e.g.
IBM Plex Mono, tabular-nums. Nice-to-have, not required for the re-skin.

| Token | Classes |
|---|---|
| Page title | `text-2xl lg:text-3xl font-bold text-ink` |
| Lesson/question prompt | `text-lg lg:text-3xl font-bold text-ink` |
| Section micro-label | `text-xs font-bold uppercase tracking-wide text-ink-3` |
| Body | `text-sm`/`text-base font-medium` |
| Secondary / hint | `text-xs text-ink-3` |
| Button label | `text-sm font-bold uppercase tracking-wide` (Button base) |

Minimum readable size: **12px (`text-xs`)**.

---

## 4. Buttons (the signature element — shape stays, color changes)

`src/shared/ui/button.tsx` (cva). Shape unchanged — SonarCoach's tactile identity:
`rounded-xl`, bold uppercase label, **thick bottom border** (`border-b-4`) that
collapses on press (`active:border-b-2/0`). Filled variants chunky; `*Outline`
flat. Recolor the variants to the new tokens:

- **`accent` (gold)** — the **primary action**, one per screen (Start, Continue,
  Generate, Approve, Publish). Gold fill, `brand-ink` (pine) label. *Was `secondary`/green.*
- **`success` (green)** — confirm/correct/positive (e.g. "Correct!", mark done).
- **`brand` / `brandOutline` (pine)** — structural/secondary actions, nav, sidebar.
- **`danger` (red)** — delete, wrong. **`locked`** — disabled (warm neutral).
  **`ghost`** — text-only (ink-2).
- Drop `super` (indigo) and the sky `primary` — fold into `accent`/`brand`.
- Sizes unchanged (`default` h-11, `sm` h-9, `lg` h-12, `icon`); `lg` for the main
  learner CTA. Always use `<Button>` (never hand-roll).

---

## 5. Cards, surfaces, radii

- **Cards:** `rounded-2xl border-2 p-5/6` on `surface` (`#fffdf7`) over the `canvas`
  cream; `border-line`. Clickable-card hover: `hover:bg-brand-soft`. SonarCoach
  keeps its **friendly large radii** (a distinct trait; CrewYield runs tighter).
- **Nested blocks** (lesson inside a unit): `rounded-xl bg-canvas-2 p-3`.
- **Controls** (inputs/selects/textareas): `rounded-xl border-2 border-line px-4 py-2`,
  `focus:border-brand-2` + a soft brand focus ring.
- **Pills / badges:** `rounded-full px-2 py-0.5 text-xs font-bold` with a semantic
  pair (success/accent/danger/brand + `-soft`/ink).
- Radii rule: `rounded-2xl` cards, `rounded-xl` controls/nested, `rounded-full` pills.

---

## 6. Status & feedback

- **Pills:** Published = `success`, Draft/in-progress = `accent-soft`/`accent-ink`,
  Failed = `danger`, AI = `accent`. (Was green/amber/rose/indigo.)
- **Toasts:** `sonner` — success (green check), error (red). Plain copy.
- **Celebration:** confetti + `/finish.svg` + points on lesson complete.
- **Mascot:** `/mascot.svg` (positive), `/mascot_bad.svg` (gentle "not quite"). The
  mascot teaches, never scolds.
- **Long jobs** (image/audio gen): show progress ("X/total done") + a retry
  affordance. Never a silent spinner.

---

## 7. Layout

- Left **sidebar** nav (pine `brand` rail, gold `accent` active item — like
  CrewYield) + main content; main pages use `px-4` with a header row.
- Content max-widths: learner screens center ~`max-w-[600px]`; forms `max-w-xl`.
- Spacing rhythm: 4/8 scale (`gap-y-2/4`, `p-3/4/6`), consistent within a view.

---

## 8. Imagery & icons

- Course/lesson art is **AI-generated**, served through the authed media proxy
  `/api/media/[id]` (never hotlinked), rendered `unoptimized`.
- Default course image `/mascot.svg`. Icons: lucide / inline SVG, single-stroke
  line style, color-inherited. Avoid decorative emoji in chrome.
- Generated illustrations: clean flat instructional style; realistic photo when a
  real scene helps. No text baked into images.

---

## 9. Motion

Subtle and functional: button press (border collapse), accordion expand
(`tailwindcss-animate`), confetti on completion. No gratuitous animation. Honor
`prefers-reduced-motion`.

---

## 10. Accessibility

- **Tap targets ≥ ~40–44px**; label icon-only controls with `aria-label`.
- **Status never color-only** — pair color with text ("failed", "Draft").
- `<audio>` voiceovers include a `<track>`; images have meaningful `alt`.
- Keep the `focus-visible` ring (gold `accent` outline, `outline-offset:2px`).
- Verify contrast after the re-skin: gold-on-pine, ink-on-cream, white-on-pine.

---

## 11. Voice & tone

Plain, concrete, encouraging. 6th-grade reading level. Job-site scenarios over
abstraction. "Not quite — here's why it matters" beats "Wrong." Never blame the
learner. Owner-facing copy is direct and practical.

---

## 12. Anti-slop rules (carried from CrewYield — keeps the family honest)

Never ship: purple/violet accents · cold SaaS blue+white+Inter · gradient CTA
buttons · 3-column icon-in-circle feature grids · rainbow KPI tiles · a second
competing accent (gold is the only one) · `system-ui`/Inter as a display face ·
stock-photo heroes. Map any one-off hue back to the §2 tokens.

---

## 13. Implementation — the re-skin migration (visual only)

Today the brand is **~90% hardcoded** Tailwind utilities (`green-500`, `sky-*`,
`teal-600`…) across ~46 files / ~166 spots; only ~5–10% lives in tokens. So a
CSS-var swap alone won't propagate. Path:

1. **Add semantic tokens.** In `tailwind.config.ts` `theme.extend.colors`, add
   `brand`, `accent`, `success`, `danger`, `info`, `canvas`, `surface`, `ink`,
   `line` (with the scales above), backed by CSS vars in `src/app/globals.css`.
2. **Migrate hardcoded utilities → tokens**, highest-leverage first:
   1. `src/shared/ui/button.tsx` (recolor cva variants — the biggest single win)
   2. `src/app/(main)/learn/lesson-button.tsx` (incl. the inline ring hex
      `#4ade80`/`#e5e7eb` → token vars) + `unit-banner.tsx`
   3. `src/shared/ui/progress.tsx` (hardcoded `bg-green-500` indicator)
   4. `src/shared/components/wordmark.tsx` + `public/logo.svg` (see below)
   5. `src/app-shell/mobile-header.tsx` (full-width `bg-green-500`)
   6. owner status-pill cluster (studio/crew/marketplace) + `focus:border-green-500`
   7. `src/app/lesson/card.tsx` / `footer.tsx` (correct/wrong/selected states)
3. **Fix the 3 non-class assets:** `layout.tsx` `themeColor` `#22C55E` → pine/gold;
   the lesson-button progress-ring inline hexes → CSS vars; `public/logo.svg` fill
   `#0d9488` → pine, plus a gold mark.
4. After migration, a future re-skin is a one-place token edit.

**Wordmark / logo:** the teal "S" tile (`#0d9488`) → a **pine tile with a gold
mark** (mirrors CrewYield's gold-square logo chip). Two-tone "**Sonar**Coach" →
**pine + gold** (or pine + success-green). Keep the same shape/letterforms.

Effort: medium, mechanical, ~46 files; gated by typecheck + build + visual review.
No backend/route/data change (confirmed).

---

## 14. Where SonarCoach is heading (LawnBoard direction — pointer)

Folded from LawnBoard's docs (its strongest, evidence-verified ideas); detail in
the product roadmap, not this design doc:
- **Lesson anatomy** as the canonical lesson template: wrong/right image pair →
  owner voice note → real-incident narrative → hard quiz, with **retry-and-
  re-lesson, no lockouts** ("Show me again" re-opens the exact teach item).
- **Owner graduation feed** (one-tap acknowledge + "needs work" insight chips).
- **Owner-voice capture → auto-generated lesson** ("the owner's voice on the new
  hire's phone") — the strategic direction above today's LMS.

These are product features (separate from this re-skin) but they shape the
learner screens this design system styles.

---

## 15. Component inventory (canonical patterns)

- **Button** — `src/shared/ui/button.tsx` (the system; use everywhere).
- **Wordmark** — `src/shared/components/wordmark.tsx` + `public/logo.svg`.
- **Sidebar / item** — `src/app-shell/sidebar.tsx`, `src/shared/components/sidebar-item.tsx`.
- **Learn path** — `src/app/(main)/learn/*` (units, lesson-path nodes, banner).
- **Lesson player / challenge** — `src/app/lesson/*` (teaching + voiceover + options).
- **Review queue** — `src/app/(main)/studio/review/*`.
- **Course editor** — `src/app/(main)/studio/[courseId]/*` (module→unit→lesson tree).
- **AI Course Wizard** — `src/app/(main)/studio/ai-course-wizard.tsx`.
