# Crewel Landing — Design Record

**Date:** 2026-08-26
**Seed:** monochrome liquid glass (user-pinned, overrides 41bf69cf)
**Copy method:** writing-beats (exploit pile: PRD + DECISIONS + SPEC)
**Marks:** actual vendor logos, monochrome white on glass

---

## Thesis

One sheet of dark glass over black. Not a light page.

`--void: #050505` with two radial washes (70% -5%, 8% 30%) at 7% and 3.5% white. All panels are `rgba(255,255,255,.055)` + `backdrop-filter: blur(24–30px) saturate(1.1)` + 1px inner stroke `rgba(255,255,255,.10)`. Single accent is white at three opacities (.92 / .55 / .34). Specular top edge on each glass card, inset highlight. No color. No second accent.

The crew roster floats inside frosted panes. Install is the only high-contrast object on the page (white pill, black text). Everything else is air.

This refuses two scaffolds at once: the dense spec-board (dark glow, flaps) and the icon-grid card farm. Six equal cards with icon+heading+text never appears.

## Own World

- Void, pill nav (blur 24), hero split (type left, glass video pane right), river, vertical rail, quiet rows, ops block, glass CTA, quiet footer.
- Video pane is a glass frame with `background: #000` stage. `<video>` is real, `playsinline controls muted loop`. Mock terminal is fallback; `playVideo()` HEAD-checks `brag-output/brag.mp4` then swaps.
- Type: Schibsted Grotesk (400/500/600) for everything. JetBrains Mono only for code/tags/meta. One display family.
- Radius: 28px (pane/CTA) / 18px (steps) / 999px (pills).

## Story

Calm instrument. You prompt the lead; the crew's state drifts past in frosted panes. Not a hype page, not a dashboard.

Beats ground in order, each reachable from what the reader already has:

1. **Gap + command** — cross-agent is the product. Board where they work together. `npm install -g crewel`.
2. **How it runs** — lead splits into checkable tickets, each teammate in its own worktree, live push, one board.
3. **What it won't do** — no daemon, no silent fail; heartbeats watch turns, rate-limit pauses.
4. **Merge gated** — `crewel/{team}/{ticket}` → `crewel/{team}/integration`, lead merges after review, `main` only on close-out PR.
5. **Roster** — OpenCode → Claude Code → Codex; third adapter is proof, one file per type, Mock for CI.
6. **Close** — One board. Mixed agents. Tickets you can trust.

Prerequisites assumed: knows coding agents, lives in terminal + npm, knows tickets. Everything else is grounded inside.

Grounding kept explicit. No beat leans on `worktree`, `TurnReport`, `mailbox` before they arrive.

## Marks

Actual shapes, monochrome treatment (currentColor = white, opacity .92).

- **OpenCode:** SimpleIcons block mark `M22 24H2V0h20zM17 4.8H7v14.4h10z` (the square frame). Official wordmark saved to `site/assets/opencode-wordmark.svg` but the mark reads at 20px; wordmark would be illegible in a 42px circle.
- **Claude:** SimpleIcons Claude star-splat path (full splat, 1936b). Not the Anthropic "A".
- **Codex:** SimpleIcons OpenAI flower (1.5k path). Codex is OpenAI; the flower is the correct family mark.
- **Mock:** stroke-only document with lines, same stroke weight, same color.

All four sit in 42px glass circles (`rgba(255,255,255,.06)`, blur 18, inner highlight). Hot row (OpenCode) gets `.11` bg and `.20` border. No brand colors on page — that would break monochrome. Hover does not re-color; it brightens glass. Shapes are real, colors are product.

Saved sources in `site/assets/` (mark, wordmark, openai) but inlined as `<symbol>` sprite to avoid extra requests and keep `fill="currentColor"` controllable by CSS.

## Copy — why it isn't slop

- No personal name on landing. Product, not persona.
- Verbs, not adjectives. No "unlock, delve, seamlessly, tailored, elevate, supercharge, in today's fast-paced world."
- Each beat does one job and stops. Leftover pile stays leftover — that's the point.
- Em-dash budget held to 1 in COPY.md, ~6 in body (detector 0 findings). Replaced with periods/colons where a dash would be filler.
- `site/COPY.md` is the beats source of truth. `site/index.html` is the pour. They track.

## Finish Review

**Detector:** `detect.mjs —json site/index.html` → 0 findings (previously `em-dash-overuse` at 14 → fixed).

**Lint:** `eslint .` → 0.

**Tests:** `vitest` full → 113 passed / 1 skipped / 1 flaky (`codex adapter — probes availability` times out under full parallel load, passes isolated). Not landing-related; no landing tests to break.

**Gate:** Stuck commits earlier from flaky CI are windowed worktree stalls; mitigated by `cleanGitEnv`. Not reproduced on this push (isolated pass).

**Verdict:** Publishable. Minimal, monochrome, glass holds; logos read at 20px on dark; beats land in order without reaching for ungrounded concepts; CTA is the only high-contrast object as intended.

## Next

- `brag-output/brag.mp4` still absent on Pages (fallback terminal plays). When ready: `hyperframes` → commit mp4 → redeploy verifies pane swap.
- If a colored press kit is ever needed, branch the sprite to a `press/` page that inverts marks to brand colors — not this page.
