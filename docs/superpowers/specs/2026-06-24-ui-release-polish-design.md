# UI Release Polish — Design

**Date:** 2026-06-24
**Goal:** Make the app look intentionally designed, not "vibe coded," for release.

## Problem

The app is heavily styled but the **default "Aurora" theme** carries every
classic AI-template tell: a rainbow violet→pink→cyan body glow, rainbow
gradient fills on buttons/segments/chips, a rainbow gradient-text wordmark,
decorative neon glows on idle elements, glassmorphism (blur+saturate) on every
surface, and inconsistent radii/spacing. Shipping five swappable themes is
itself an over-produced tell. The code already half-acknowledges this —
`theme.ts` notes Broadcast/Cinema "drop the AI-template tells" — but the
flashy theme is still the default.

## Direction (approved)

Ship **two** themes; the default is a disciplined instrument look.

1. **`studio` (new default)** — instrument identity, evolves the current
   Broadcast theme. Single **cyan-teal accent** (`#3dd6c4` family), flat matte
   graphite surfaces, no decorative glow, crisp borders, normalized radii/spacing.
2. **`aurora` (refined, the one alternate)** — dark + colorful but tamed: a
   single violet accent (no rainbow), body glow washes removed, most glass
   dropped. Keeps a "modern dark" option without the AI look.

**Remove** `cinema`, `mono`, `tactical` entirely (TS + CSS).

Functional colors stay meaningful and unchanged: REC red (and its earned pulse
+ glow *while actually recording*), focus-guide amber/green, detection-box
colors, tally. Only *decorative* color/glow is removed.

## Token system

Re-base so the **flat instrument look is the CSS base** (`:root`), and Aurora
is the one theme that *adds back* glass/glow/tint via `[data-theme="aurora"]`.
This inverts today's "base = aurora, everything else strips it" arrangement and
is cleaner now that flat is the default.

### `:root` (studio default)
```
--bg: #0b0d10;            --text: #e8ebf0;   --muted: #8b93a3;  --faint: #59616f;
--glass: #14171c;        --glass-2: #1a1e24;                    /* flat surfaces */
--border: rgba(255,255,255,0.08);  --border-strong: rgba(255,255,255,0.17);
--accent: #3dd6c4;  --accent-2: #3dd6c4;  --accent-grad: #3dd6c4;   /* flat, NOT a gradient */
--accent-glow: rgba(61,214,196,0.25);     /* modest, functional only: focus ring + slider thumb */
--ok: #34d39a;  --warn: #ffce5a;
--rec: #ff3b3b;  --rec-2: #ff3b3b;  --rec-grad: #ff3b3b;  --rec-glow: rgba(255,59,59,0.45);
--radius: 8px;  --radius-sm: 6px;          /* 2-step scale; replace ad-hoc 16/12/11/10/9px */
--shadow: 0 10px 30px rgba(0,0,0,0.5);  --shadow-sm: 0 4px 14px rgba(0,0,0,0.42);
```
Body: flat `var(--bg)` + one barely-there top vignette
(`radial-gradient(1400px 700px at 50% -20%, rgba(255,255,255,0.025), transparent 60%)`).

### `[data-theme="aurora"]` (refined alternate)
```
--accent: #8b7bff;  --accent-2: #8b7bff;  --accent-grad: #8b7bff;  /* single violet, NO rainbow */
--accent-glow: rgba(139,123,255,0.28);
--radius: 10px; --radius-sm: 8px;
```
Body: remove the 3 rainbow radial washes; one subtle low-alpha violet top wash only.
Aurora-only additions: header tinted glass + blur, `.card` backdrop blur.

## Changes by file

- **`theme.css`**
  - `:root` → studio tokens (above). Body base → flat + faint vignette.
  - Add `[data-theme="aurora"]` block: violet tokens, subtle wash, glass/blur add-backs.
  - Delete the `broadcast`, `cinema`, `mono`, `tactical` blocks and their
    per-theme typography / squared-corner / LED-pip overrides.
  - Replace the "non-aurora strips glass" overrides with "aurora adds glass."
- **`app.css`** (re-base to flat; normalize)
  - `.app__header`: base flat (`var(--glass)`, no blur); aurora adds tinted glass+blur.
  - `.brand__mark`: flat `var(--accent)` text (kill rainbow gradient) for base.
  - `.card`: base no `backdrop-filter`; aurora adds blur.
  - `.btn--accent`: base shadow → `var(--shadow-sm)` (kill hardcoded violet glow).
  - Normalize hardcoded radii to `var(--radius)` / `var(--radius-sm)`
    (rec-btn, osd-btn, video, select/input, seg, stepper, chips, act, etc.).
  - Decorative glow box-shadows that read as neon → removed/reduced; functional
    rings (focus, slider thumb) keep `--accent-glow` (now modest).
- **`theme.ts`**
  - `ThemeName = 'studio' | 'aurora'`; `THEMES` lists the two; default `studio`.
  - `getTheme`: migrate any stored legacy value (`broadcast`/`cinema`/`mono`/
    `tactical` or unknown) → `studio`; keep `aurora` if stored.
- **`AppShell.tsx`** — no structural change (theme `<select>` already maps `THEMES`).

## Out of scope / non-goals

- No component/DOM restructure, no camera-control logic touched.
- No new fonts/assets beyond what's already referenced.
- Live-view functional overlays (OSD, tally, detection, focus guide) keep their
  meaning-bearing colors.

## Proof

- App builds; renderer loads with `studio` default; switching to `aurora` works;
  legacy stored theme values fall back to `studio`.
- Visual check: no rainbow anywhere, flat surfaces, single accent, glow only on
  active REC; spacing/radii consistent.
