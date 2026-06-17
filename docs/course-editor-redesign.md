# Course Editor Redesign — 3-Pane Authoring Workspace

Plan-design-review output (2026-06-17, branch `main`, calibrated to `DESIGN.md`).
Route: `/studio/[courseId]`. Backend unchanged — this is an IA + presentation
redesign. Mockup: the 3-pane layout shown in the review chat (and the new IA
described below). Initial design score **3/10 → 9/10** after this plan.

## The problem (current editor)

`studio-editor.tsx` renders the whole course as a flat, infinite vertical scroll:
every field of every lesson (teaching textarea, anatomy add-buttons, image
thumbnails, voiceover, every question row) is expanded inline at once, with no
navigation and no overview. For a real course (4 modules × 3 units × 4 lessons)
that's a wall of forms. It breaks four principles: **wayfinding** (no outline,
fails the trunk test), **hierarchy** (everything is the same weight),
**progressive disclosure** (nothing collapses), and **calm** (uppercase labels +
stacked fields everywhere). The product's headline capability — AI — is a
scatter of tiny "✨ AI" text links.

## The redesign: a focused 3-pane workspace

Authoring becomes **navigate → focus → edit** instead of *scroll a giant form*.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← courses   Pesticide & Herbicide Safety  [Published]   ▓▓▓░ 8/12 ready  │  HEADER (sticky, h=56)
│                                              [Preview] [Publish] 🇺🇸        │
├──────────────┬──────────────────────────────────────────┬────────────────┤
│ OUTLINE  280 │ EDITOR CANVAS  (fluid, max 760)           │ INSPECTOR  300 │
│              │                                            │                │
│ [find…]      │ Mower Basics › Lesson                      │ ASSIST         │
│ ▾ Equipment  │ Keep People and Pets Out   [needs voice]   │ [✦ Generate]   │  gold
│   ▾ Mower    │ ┌ Teaching | Teach items 4 | Questions 4 | │ [ Translate ]  │
│     • Pre…✓  │ │ Media ┐                                  │ [ Add to lib ] │
│     ● Keep…! │ │  (one section at a time, calm)           │                │
│   ▸ Before…  │ │                                          │ READY TO SHIP  │
│ + module     │ └──────────────────────────────────────┘  │ ✓ teaching     │
│              │ [✦ Improve with AI]  [Save]                │ ✓ 4 questions  │
│              │                                            │ ◷ 2 imgs gen   │
│              │                                            │ ○ no voiceover │
│              │                                            │ ── queue: 2🖼1🔊│
└──────────────┴──────────────────────────────────────────┴────────────────┘
```

### Pane 1 — Outline navigator (left, 280px, pine-tinted surface)
The wayfinding fix. A collapsible tree: **module › unit › lesson**, with a
sticky search/filter at top. Each lesson row carries compact **status chips**
(IBM Plex Mono): question count, media state, voiceover, and a single
ready/needs-work glyph (gold ✓ = ready, amber ⚠ = needs work). The selected
lesson is highlighted gold (the single accent). `+ module / + unit / + lesson`
affordances inline. Drag-to-reorder (P2). This is the overview the current
editor has none of.

### Pane 2 — Editor canvas (center, fluid, max-width 760)
One thing at a time. Breadcrumb (`Mower Basics › Lesson`) + lesson title
(Fraunces) + a status pill. A **segmented control** switches between
**Teaching · Teach items · Questions · Media** — only one is shown, so the
canvas is calm and scannable instead of a 5-section stack. Inline `✦ Improve
with AI` on the active field; autosave with a quiet "Saved" indicator.

### Pane 3 — Inspector (right, 300px, collapsible)
Makes AI first-class and consolidates status. Top: **Assist** — `✦ Generate
lesson`, `Translate`, `Add to library` as real buttons (gold primary), not text
links. Middle: a **publish-readiness checklist** for the selected lesson
(teaching ✓, N questions ✓, images generating ◷, voiceover ○). Bottom: the
**generation queue** — the scattered inline "pending" thumbnails collapse into
one honest status line ("2 images, 1 voice generating"). Collapses to a rail on
narrow desktop.

### Course header (sticky)
Back · course title (Fraunces) · status pill · a real **completeness meter**
(N of M lessons publish-ready) · primary actions. Translate/Library/Assign move
off the page body into the inspector + a header overflow, ending the
"stack of big panels above the content" pattern.

---

## Pass 1 — Information Architecture  (2/10 → 9/10)
Flat scroll → 3-pane workspace with an outline tree + completeness header.
Primary = the lesson you're editing (canvas). Secondary = where it sits
(outline). Tertiary = its readiness + AI (inspector). The remaining point to 10:
drag-to-reorder spec (deferred, T-P2).

## Pass 2 — Interaction State Coverage  (3/10 → 9/10)

| Surface | Loading | Empty | Error | Success | Partial/Generating |
|---|---|---|---|---|---|
| Outline | 3 skeleton rows | "No modules yet — Generate a course with AI or + Add module" (warm, primary action) | inline retry toast | tree renders, first lesson auto-selected | n/a |
| Canvas | field skeletons | "Pick a lesson on the left to start editing" | field-level error + retry | quiet "Saved ✓" after autosave | n/a |
| Questions | — | "No questions yet — + Add or ✦ Generate" | per-row error | row appears | — |
| Media (img/voice) | thumb skeleton | "No image yet — Upload or ✦ Generate" | "failed — retry" chip (danger) | thumbnail + ✓ | ◷ "generating…" in inspector queue, not scattered |
| Readiness checklist | — | (always present) | — | all-✓ → header meter turns gold | mixed ✓/◷/○ states |

Empty states are warm + carry the primary action (AI generate / add). No bare
"No items found."

## Pass 3 — User Journey & Emotional Arc  (4/10 → 9/10)

| Step | User does | Feels | Plan supports it |
|---|---|---|---|
| Open course | scans outline | "I see the whole course + what's unfinished" | outline tree + completeness meter |
| Pick a lesson | clicks a row | "focused, not buried" | canvas shows just that lesson |
| Edit teaching | types / ✦ Improve | "the AI is right here" | inline improve + inspector Assist |
| Fill gaps | follows readiness checklist | "I know exactly what's left" | per-lesson checklist + queue |
| Publish | sees 12/12 ready | "confident" | meter goes gold, Publish primary |

5-sec: "this is a real authoring tool." 5-min: "I can move fast." 5-year:
"managing 30 courses is navigable, not a scroll marathon."

## Pass 4 — AI Slop Risk  (n/a → 9/10)
Classifier: **APP UI** (data-dense authoring workspace) → App UI rules. Calm
surface hierarchy, one gold accent, utility copy, no card mosaic, no decorative
gradients/ornament. None of the 10 slop patterns apply (no 3-col grid, no
centered hero, no bubbly radius, no emoji-as-UI). The mockup is a workspace, not
a template.

## Pass 5 — Design System Alignment  (7/10 → 10/10)
100% on `DESIGN.md` / CrewYield tokens: pine chrome, **gold = the single
accent** (primary actions + active outline row), cream canvas, `surface` cards,
Fraunces titles, Hanken body, **IBM Plex Mono for status chips + counts +
completeness meter** (finally uses the mono face the system defines), lucide
stroke icons, the collapsible-disclosure pattern already shipped. No new color
tokens. New components: `OutlineTree`, `EditorCanvas` + segmented control,
`Inspector` (Assist / ReadinessChecklist / GenerationQueue) — all built from
existing primitives.

## Pass 6 — Responsive & Accessibility  (2/10 → 8/10)
- **Desktop (≥1280):** full 3-pane.
- **Tablet (768–1279):** inspector collapses to a right rail; tap to expand as an overlay.
- **Mobile (<768):** *(D1 — resolved)* responsive single-pane stack — outline list → tap a lesson → full-screen editor → inspector as a bottom sheet. Owners can edit from a phone; each pane is its own view, never a squished 3-up. T6 carries this responsive work.
- **A11y:** ARIA landmarks (`nav` outline / `main` canvas / `complementary` inspector); gold `focus-visible` rings (token); 44px targets; arrow/`j`/`k` to move between lessons; segmented control as a proper tablist; contrast already AA via tokens. Command palette (⌘K: jump-to-lesson, run AI, add content) = P2.

## Pass 7 — Design Decisions

| Decision | Resolution |
|---|---|
| **D1 Mobile authoring model** | ✅ **RESOLVED** — responsive single-pane stack (outline → full-screen editor → inspector bottom sheet); owners can edit from a phone. T6. |
| D2 Drag-to-reorder lessons | Deferred to P3 (T7); up/down control suffices for v1. |
| D3 Command palette (⌘K) | Deferred to P3 (T7); clicking suffices for v1. |
| D4 Autosave vs explicit Save | Default: autosave + quiet "Saved" + undo (implementer's call). |

D1 (the one genuine fork) is resolved. D2–D4 are recommended defaults.

## NOT in scope
- Re-skin (colors/fonts/sidebar) — already shipped this session.
- Backend/schema changes — pure presentation/IA; reuses all existing server actions.
- The learner-facing lesson player — separate surface.
- Drag-reorder, command palette, real-time collab — explicit TODOs (D2/D3).

## What already exists (reuse)
`DESIGN.md` tokens + Fraunces/Hanken/IBM Plex Mono; lucide icons; the
collapsible-disclosure pattern (translate/marketplace panels); all studio server
actions (`content.ts`, `lesson-items.ts`, `course-assets.ts`, translate runner);
`getCourseTree` (already loads the full module→unit→lesson→items tree for the
editor); the existing field editors (`LessonTeachingEditor`, `LessonAnatomyEditor`,
`QuestionForm`) — these become the canvas's tab contents, not stacked sections.

## Implementation Tasks
Synthesized from the findings. Backend untouched; this is a `studio/[courseId]`
component restructure.

- [ ] **T1 (P1, human ~2-3d / CC ~4h)** — studio shell — build the 3-pane layout (`OutlineNav` + `EditorCanvas` + `Inspector`) + sticky course header with completeness meter; selected-lesson state lifted to a client store/URL param (`?lesson=`).
  - Surfaced by: Pass 1 (IA), the mockup.
  - Files: `src/app/(main)/studio/[courseId]/studio-editor.tsx` (rewrite shell), new `outline-nav.tsx`, `editor-canvas.tsx`, `inspector.tsx`.
  - Verify: navigate a multi-module course; selecting a lesson focuses the canvas; header meter reflects readiness.
- [ ] **T2 (P1, human ~1d / CC ~2h)** — outline tree — collapsible module›unit›lesson tree with status chips (IBM Plex Mono) + active highlight + search filter + add affordances.
  - Surfaced by: Pass 1, Pass 2 (status), Pass 5 (mono).
  - Files: `outline-nav.tsx`; reuse `getCourseTree`.
  - Verify: chips reflect question count / media / voiceover / ready state.
- [ ] **T3 (P1, human ~1d / CC ~2h)** — editor canvas — segmented Teaching/Teach items/Questions/Media; mount the existing field editors as tab contents; inline AI-improve; autosave + "Saved".
  - Surfaced by: Pass 1, Pass 3.
  - Files: `editor-canvas.tsx`; reuse `LessonTeachingEditor`, `LessonAnatomyEditor`, `QuestionForm`, asset bits.
  - Verify: each tab edits + persists via existing actions.
- [ ] **T4 (P1, human ~0.5d / CC ~1.5h)** — inspector — Assist (gold Generate/Translate/Library), per-lesson readiness checklist, consolidated generation queue.
  - Surfaced by: Pass 2, AI-as-footnote finding.
  - Files: `inspector.tsx`; reuse generate-images + translate flows.
  - Verify: readiness updates live; queue replaces scattered "pending" thumbs.
- [ ] **T5 (P1, human ~0.5d / CC ~1.5h)** — states — empty/loading/error/generating per Pass 2 table (warm empties with primary actions).
  - Files: the three new panes.
  - Verify: new-course empty state offers AI-generate; failures show retry.
- [ ] **T6 (P2, human ~1d / CC ~2h)** — responsive + a11y — tablet inspector rail; mobile per D1; landmarks, focus rings, 44px, j/k nav, tablist semantics.
  - Surfaced by: Pass 6.
- [ ] **T7 (P3 TODO)** — drag-reorder (D2), command palette ⌘K (D3).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score 3/10 → 9/10; 7 passes; D1 resolved (responsive stack); D2–D4 defaulted |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **VERDICT:** DESIGN REVIEWED — course-editor redesign spec'd (3/10 → 9/10), full 3-pane authoring workspace approved + mocked, mobile model resolved. Eng review recommended before implementation (the shell rewrite + selected-lesson state lifting have architectural implications worth validating).

NO UNRESOLVED DECISIONS
