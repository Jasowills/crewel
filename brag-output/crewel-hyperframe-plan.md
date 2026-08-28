# Crewel — Hyperframe Video Plan (Script-Locked, 77–90s Cinematic)

**Date:** 2026-08-28
**Source project:** `/Users/jasonamadi/crewel` (static site `site/index.html`, 1200px landing, monochrome liquid-glass design)
**Video spec:** 16:9, 77–90s, cinematic developer-tool launch, dark terminal + glass + thread metaphor
**Constraint:** Must match the provided 9-scene script + full voiceover verbatim. No invented capabilities, no cloud/AGI claims.

> This plan replaces the default `brag` 15–25s template. The user-authored script is the contract. Every timing, line, and product claim is mapped 1:1.

---

## 1. What this project actually is (Step-1 Rubric)

1. **What is the app?** Crewel is a local CLI that stitches heterogeneous coding agents (OpenCode, Claude Code, Codex, Mock) into one ticket-driven team — a dedicated non-coding lead decomposes a request into tickets, teammates execute in isolated `crewel/{team}/integration` + `crewel/{team}/{ticket}` worktrees, and all state lives as human-readable JSON/Markdown under `.crewel/` with live `fs.watch` notifications.

2. **Strongest single-line claim:** _"A mixed crew of coding agents, stitched together on one ticket board."_ Every competitor is single-vendor; this is the only cross-agent board. Second line: `npm install -g crewel`.

3. **Visual hook:** Dark void `#050505` + frosted glass `rgba(255,255,255,.06) | blur 24–30px | inner stroke .12` + white at `.92/.55/.34` + JetBrains Mono terminal + subtle thread/suture lines weaving agents into one fabric. The strongest sell is _three different agent terminals working in parallel and converging into one integration branch_.

4. **Must show from real UI/material:** The glass `site/index.html` hero mock (`$ crewel init → lead> Add login flow per docs/spec.md → ✓ decomposed into 3 tickets`), the ticket board states (`open → assigned → in-progress → needs-clarification → in-review → blocked → done`), the branch topology diagram (`main → crewel/demo/integration → teammate/opencode-1 | claude-1 | codex-1`), and the `.crewel/` filesystem tree with a readable `AUTH-SCHEMA.md / .json` + mail.

5. **Shortest satisfying video:** The user's cut is 77–90s. At cinematic devtool pacing (400ms medium holds, sentences held 0.3s/word), 85s is tight but honest. No shorter tells the story. This is not a 20s brag; it is a launch film.

6. **Tone:**
   - Preset: **cinematic** (closest), but reinterpreted as _premium developer infrastructure_ — Linear/Pulse calm + Vercel terminal severity. Not chaotic, not parody.
   - Creative direction: _"Linear meets Vercel with an embroidery thread — a dark, confident, engineer-to-engineer launch film that shows real terminal work instead of AI sparkle."_
   - Interpretation: Fewer scenes, longer holds (4–9s each), medium-fast camera, modest scale moves (1.04–1.08), clean cuts/dissolves over wipes, type slams with long holds, glass depth, subtle grain.

7. **Audio feel:** Low, confident cinematic bed — muted pulsing sub, soft perc, restrained hits for reveals. Voiceover is the lead instrument; music ducks to ~0.14 under narration and returns in gaps. Sparse, motion-matched SFX: keyboard ticks for typing, card-slide for ticket moves, soft bell for `mail`, paper shuffle for branch merges. No stock whooshes.

8. **Share copy (draft):** `Crewel — different agents, one team. OpenCode + Claude Code + Codex on one ticket board. npm install -g crewel` (also carries to `share-copy.txt`)

9. **User flow worth showing:** `lead> Add a login flow per docs/spec.md` → lead decomposes to `AUTH-SCHEMA / LOGIN-ROUTE / LOGIN-TESTS` with assignee + acceptance → three isolated worktrees in parallel → live board moves + mail clarification → stall/rate-limit auto-pause resilience → DONE 3/3 → review → merge into `crewel/demo/integration` → `main` → `.crewel/` inspectable → hero stitch.

---

## 2. Reference research (what good actually looks like)

### Primary references audited

| Ref                                                                                                        | Why it matters                                                                                                                                                                                                                                             | What to steal                                                                                                                                                                                                             | What to avoid                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Linear — Product development system** (linear.app) + motion lab (designlang)                             | Current gold standard for devtool film: calm, dark, ease-out dominant (79× `cubic-bezier(0.25,0.46,0.45,0.94)`), durations xs 100 / sm 160 / md 400ms, 207 bespoke keyframes. The motion _feels_ engineered, not decorated.                                | Linear's **ease-out 0.25,0.46,0.45,0.94** for ticket/branch reveals; 160ms micro, 400ms medium holds; type hierarchy with dimmed secondary lines; glass depth + specular sweep; progress/inbox patterns for board states. | Linear's density — Crewel should be sparser. One stitch metaphor is enough.                                   |
| **Vercel — Develop. Preview. Ship.**                                                                       | Terminal + deploy pipeline as hero: real `git push` → preview URL → comment. Proves a devtool film can center the terminal without feeling CLI-only.                                                                                                       | The **push-to-deploy pipeline visualization** — branch → preview → merge — as the template for Scene 7's `teammate/* → integration → main` convergence. Keep code snippets realistic and readable (1–2 lines, not walls). | Vercel's blue-purple gradients — wrong palette for Crewel void/glass.                                         |
| **Vidico — 8 Best Product Launch Videos (2026)**                                                           | Strategic framing: _one core message in the first 10s_, lead with problem not feature list, show product in use for credibility, 1–3 min optimal for launch films (86% lift when video is above fold). Elevates why Crewel's Scene 1 hook must land in 3s. | Structure: **Problem → Resolve hook → Product in use → Outcome**. Keep first 10s readable at 2× viewing speed.                                                                                                            | Over-produced explainer voice from vidico template — Crewel VO must be dry, senior-engineer, not infomercial. |
| **Railway, Warp, Raycast, Cursor launches** (Launch Video Library, impractical.ai — >150 launches indexed) | Volume proof that devtool launches succeed with _dark terminal + board + diff_ rather than illustration. Railway Cloud Agents, Warp, Raycast 2026 drops all anchor on the actual UI.                                                                       | Three-way split-screen for parallel work (Scene 4). Ticket cards moving columns. Branch graph as thin geometry, not skeuomorphic plumbing.                                                                                | Neon-glow terminal cliché — Vidico + Railway show polish comes from _restraint_, not glow.                    |

### Motion principles adopted for Crewel

- **Easing:** Linear's `ease-out (0.25,0.46,0.45,0.94)` for entrances; `easeInOut` only for camera drifts. No `easeIn` except for exits.
- **Durations:** Tick 140–180ms, entry 380–520ms, hold 800ms (short label) to 2.2s (sentence). Voiceover dictates hold; motion never truncates VO.
- **Camera:** Subtle dolly (scale 1.04–1.08) + 4–8px drift on still stages. No whip pans. Transitions are **cut (120ms) or dissolve (260ms)**; thread morph uses **path draw 700ms**.
- **Typography rhythm:** Fast-in, then _hold_. Every readable line gets its floor (0.8s label, 0.3s/word sentence). Sequential ticket reveals snap to every _other_ beat if tempo is fast; otherwise one per beat with post-hold.
- **Palette law:** No new hue enters the film. Threads are **white at varying opacity + 1px stroke**, not color. Brand pills appear only once, in Scene 2/9, at 42px circles (opencode white/#201D1D, claude #D97757 on clay, openai black on white) as in `site/index.html` — never smeared across UI.

---

## 3. Asset inventory (exact values from project)

### Colors (contract — do not invent)

```css
--void: #050505 --glass: rgba(255, 255, 255, 0.055)
  --glass-strong: rgba(255, 255, 255, 0.09) --stroke: rgba(255, 255, 255, 0.1)
  --stroke-bright: rgba(255, 255, 255, 0.22) --w1: rgba(255, 255, 255, 0.92)
  /* primary text */ --w2: rgba(255, 255, 255, 0.55) /* secondary */
  --w3: rgba(255, 255, 255, 0.34) /* tertiary / labels */ --r-lg: 28px
  --r-md: 18px --r-pill: 999px;
```

Provider pills only (Scene 2/9): opencode #201D1D on #FFFFFF, claude #D97757 on rgba(217,119,87,0.14), openai #000 on #FFFFFF, mock monochrome. All other UI is monochrome.

### Typography

- Display: **Schibsted Grotesk** 400/500/600 (from `site/index.html` Google Fonts). Fallback: Inter/system-ui, tracked -0.03em.
- Mono (terminals, code, tags, board): **JetBrains Mono** 400/500. Sizes: 10.5–14.5px UI, 18–26px HUD lines in film.
- Hero scale: 46–84px clamp in site maps to ~64–96px film titles.

### Logos / marks (inline `<symbol>` sprite in `site/index.html:614–645`)

- `logo-opencode` — block frame `M22 24H2V0h20zM17 4.8H7v14.4h10z` (currentColor; CSS maps to #201D1D)
- `logo-claude` — star-splat path (currentColor; CSS #D97757)
- `logo-openai` — flower (currentColor; CSS #000)
- `logo-mock` — stroke document (currentColor; stays monochrome)

Favicon X-stitch (`site/favicon.svg`): 32×32 `#050505` + white X + 2.4px dot — usable as subtle micro mark in Scene 9 stitch.

### Key copy that must appear verbatim (from script)

- `Add a login flow per docs/spec.md`
- `One request.` / `A lot of work.`
- `CREWEL` / `A mixed crew of coding agents, stitched together on one ticket board.`
- `OpenCode + Claude Code + Codex` / `One team. One board.`
- `lead> Add a login flow per docs/spec.md`
- Tickets: `AUTH-SCHEMA / LOGIN-ROUTE / LOGIN-TESTS` with descriptions + `→ OpenCode / Claude Code / Codex`
- Parallel HUD: `IN PROGRESS` ×3, branch tree `main → crewel/demo/integration → teammate/opencode-1 | claude-1 | codex-1`
- Board states: `OPEN → ASSIGNED → IN-PROGRESS → IN-REVIEW → DONE` + `NEEDS-CLARIFICATION` + `BLOCKED`
- Mail: `[mail] claude-1 → lead — Login route implemented. Ready for review.` and `codex-1 → lead — Tests require clarification: Should failed login attempts be rate limited?`
- Resilience flashes: `STALL DETECTED → AUTO-PAUSE`, `RATE LIMIT → PAUSED`, `WORKTREE CLEAN → REASSIGN`
- Summary: `CREWEL / DEMO — OPEN 0 … DONE 3` + `✓ auth-schema / login-route / login-tests`
- Inspectable state: `.crewel/ — teams/ tickets/ state/ mail/` + readable JSON/Markdown
- Final tagline lines: `OpenCode · Claude Code · Codex / Agent-agnostic. / Ticket-driven. / Built for real engineering teams.`

### Voiceover script (exact, 9 paragraphs — audio contract)

> "Software doesn't get complicated because one engineer can't solve it. It gets complicated because there's a lot to solve at once.
>
> Crewel turns different coding agents into one coordinated engineering team.
>
> Give the lead a request. It breaks the work into concrete tickets, defines what done means, and delegates the work.
>
> OpenCode, Claude Code, Codex, each agent works independently in its own isolated worktree.
>
> They execute in parallel, communicate through a shared state layer, and can ask for clarification instead of guessing.
>
> When something stalls, hits a rate limit, or fails repeatedly, Crewel can pause, freeze, or safely reassign the work.
>
> As each ticket is completed, the work comes back together for review and integration.
>
> And because everything lives in human-readable JSON and Markdown, the system stays inspectable.
>
> Different agents.
>
> One team.
>
> Crewel."

Narration voice: natural, confident male or female, developer-paced, not ad-exaggerated. Hyperframes Kokoro `af_heart` equivalent; music ducks during VO.

### Product accuracy fence (non-negotiable)

Show accurately: OpenCode / Claude Code / Codex / Mock adapters; mixed team + lead orchestrator; ticket-driven with status/assignee/dependencies/acceptance; `needs-clarification` first-class; isolated worktrees `crewel/{team}/integration` + `crewel/{team}/{ticket}`; shared `.crewel/`; `fs.watch` live notifications; stall watchdog; rate-limit auto-pause; freeze after 3 failures; hybrid reassignment on clean worktrees only; human-readable JSON/Markdown; lead reviews only after `in-review`; `main` untouched until close-out PR.

Never show: fully autonomous dev, guaranteed bug-free, agents replacing engineers, cloud infra, proprietary model, internet-scale distribution.

---

## 4. Visual direction (one system across 9 scenes)

### Environment vocabulary

- **Containers:** frosted glass panels (`rgba(255,255,255,.06) + blur(24–30) + inner stroke + specular top edge at 10%`) over `#050505` with two radial washes (70% −5% at 7%, 8% 30% at 3.5%).
- **Terminals:** `#000` stage inside glass pane, JetBrains Mono, cursor block at 92% white, line-height 1.9, green `✓` stays white (monochrome rule) — success is weight, not color.
- **Tickets:** glass cards `rgba(.06) + 1px stroke`, pill status, mono id + sans title + acceptance checkmarks; motion is **slide + fade** on a 42px column grid (Linear board reference).
- **Branch graph:** thin 1px white at 18% + 0.5px glow, orthogonal lines with 6px dots; merge is a dot that swells 1→10px and settles.
- **Thread/weave:** 0.7–1.1px white lines at 22%–45% opacity, 3 distinct dash phases (one per agent) converging; width animates, not hue. Substrate is always the glass, not illustration.
- **Texture:** faint 2% film grain + 1% vignette on every stage; 1px inner highlight on glass edges. No lens flares.

### The "stitch" metaphor (own it, don't overdo it)

- Scene 2: three threads enter from left, each labeled (`OpenCode` 201D1D-chip, `Claude` clay, `Codex` black-on-white), braid into one pane's bottom edge — 1.2s draw.
- Scene 4: thread underlay beneath the 3 panes (continuous line from `integration` to each `teammate/*` branch).
- Scene 9: return — three threads converge into a single embroidered `X` (favicon mark at 140px), then reveal `CREWEL` wordmark. Hold 2.2s.

---

## 5. Storyboard (script-locked — duration, VO, visuals, SFX)

Base canvas 1920×1080 (16:9), 30fps render, 24fps feel (hyperframes native step can simulate).

### Scene 1 — THE PROBLEM — 0:00–0:08 (8.0s)

- **Visual:** Dark terminal (glass pane, black stage). Blinking cursor types `Add a login flow per docs/spec.md` (0.6s type, 300ms/pair). Pause 0.7s — request sits alone. Fade in `One request.` (mono caps, 10.5px, 14% letter-spacing) 0.45s. 1.1s later replace with `A lot of work.` Cross-dissolve. Screen _splits_ into 3 glass cards sliding from center (160ms stagger, 420ms ease-out) — ghost titles `AUTH-SCHEMA / LOGIN-ROUTE / LOGIN-TESTS` at 12% opacity teased.
- **VO:** "Software doesn't get complicated because one engineer can't solve it. It gets complicated because there's a lot to solve at once." (0:00.4–0:07.6)
- **SFX:** keyboard ticks (pair ticks), soft `whoosh` for split, 60% music bed.
- **Transition → Scene 2:** thread lines grow from split edges, dissolve 260ms into Scene 2 weave.

### Scene 2 — INTRODUCE CREWEL — 0:08–0:16 (8.0s)

- **Visual:** Cut to void with `CREWEL` 84px Schibsted 500, -0.035em, white .92 — 440ms scale 0.96→1.00 + fade. Subtitle 16px .55 opacity appears 0.45s later. Three agent pills enter left→right (OpenCode white/charcoal, Claude clay, Codex white/black) 140ms stagger, each with its real mark at 20px. Thin threads (one per pill) weave into a single frosted pane edge — path draw 700ms. Lockup animates: pills → `OpenCode + Claude Code + Codex` → `One team. One board.` (mono, 11px caps).
- **VO:** "Crewel turns different coding agents into one coordinated engineering team." (0:08.2–0:15.0)
- **SFX:** three card-place clicks (one per agent), soft thread tension ticks.
- **Transition:** threads tighten, cut to terminal prompt 120ms.

### Scene 3 — LEAD DECOMPOSES — 0:16–0:27 (11.0s)

- **Visual:** Terminal prompt `lead> Add a login flow per docs/spec.md` with cursor blink. Lead cursor analyzes (2 soft pulses on `lead>` dot). Request _fractures_ into 3 ticket cards (auth-schema, login-route, login-tests) each with: id caps 10.5px, title 15px 600, acceptance checkmarks (1 line each): `auth-schema: users table migration + session store`, `login-route: POST /login → 200 + set-cookie / 401`, `login-tests: unit + integration, 80% branch`. Status `OPEN` → `ASSIGNED` on assignment. Arrows draw 380ms each: `→ OpenCode` (white), `→ Claude Code` (clay pill), `→ Codex` (black-on-white).
- **VO:** "Instead of throwing the whole problem at every agent, Crewel gives the team a lead. The lead breaks the request into concrete tickets, defines the work, and delegates it." (0:16.2–0:26.4) _Script says this variant; closing VO will repeat the shorter "Give the lead a request..." — keep Scene 3 at this longer cut._
- **SFX:** typing, fracture tick, three assignment clicks.
- **Transition:** cards scale 0.96→1 and slide to positions that become Scene 4 panes (260ms).

### Scene 4 — PARALLEL EXECUTION — 0:27–0:40 (13.0s) ★ HERO — visually tallest

- **Visual:** Screen divides into 3 equal glass workspaces (16px gap, 28px radius on outer container). Each header: `OpenCode · auth-schema · IN PROGRESS` etc. with pulsing dot (white). Body: realistic terminal work — `git checkout -b crewel/demo/auth-schema`, `rg schema`, `npm test`, file diffs (`+ users` , `+ POST /api/login`), test runs (`PASS 3/3`). Each is its own PTY — cursor at different phase. Lower-third branch graph appears at 0:33: `main | crewel/demo/integration + teammate/opencode-1 | claude-1 | codex-1` — `main` dimmed, worktrees bright; lines pulse 1.6s. HUD fades: `Parallel execution.` (1.0s) → `Isolated worktrees.` (1.2s) in mono caps over graph. `main remains untouched.` as tiny 10px caption.
- **VO:** "Every teammate works independently in an isolated git worktree, so agents can move fast without stepping on each other." (0:27.5–0:33.5) _Pairs with longer VO block "OpenCode, Claude Code, Codex, each agent works independently..." — keep tighter for this scene, redundant line lands here._
- **SFX:** three overlapping typing layers (left/center/right at -6/-10/-8 dB), faint git checkout click, two success ticks for passing tests.
- **Transition:** panes collapse upward into board columns, dissolve 260ms.

### Scene 5 — AGENTS COMMUNICATE — 0:40–0:50 (10.0s)

- **Visual:** Board with 7 columns: `OPEN 0 | ASSIGNED 0 | IN-PROGRESS 3 | NEEDS-CLARIFICATION 0 | IN-REVIEW 0 | BLOCKED 0 | DONE 0`. Tickets slide columns: `OPEN→ASSIGNED→IN-PROGRESS→IN-REVIEW→DONE` (each 420ms, staggered 160ms). Notifications pop from top-right (glass): `✉ claude-1 → lead — Login route implemented. Ready for review.` (bell ding 0.3s). Second: `✉ codex-1 → lead — Tests require clarification: Should failed login attempts be rate limited?` (higher ding). Ticket `login-tests` moves `NEEDS-CLARIFICATION` (amber-leaning white + pause icon) then back `IN-PROGRESS` after lead answer (`lead: yes — 5 attempts / 15 min`). Show live push — subtle flash on affected column.
- **VO:** "And agents don't have to guess. Crewel gives them a shared, human-readable state layer, live notifications, and clarification as a first-class state." (0:40.2–0:49.0)
- **HUD:** `Don't guess. Coordinate.` (large, 28px, appears at 0:45 for 1.6s)
- **SFX:** card-slide per column move, two `mail` plucks, typing for lead answer.
- **Transition:** board breathes out, micro-zoom 1.04 → Scene 6 montage cut.

### Scene 6 — RESILIENCE — 0:50–0:59 (9.0s) ★ fastest montage

- **Visual:** Three rapid vignettes (2.7s each) over same board, zoomed in:
  1. `Claude Code — STALL DETECTED` amber badge, heartbeat line flatlines, watchdog sweep, then `AUTO-PAUSE` pill locks the lane.
  2. `RATE LIMIT → PAUSED` — 429 badge, teammate lane grays 40%, timer `retry in 47s`, board keeps progressing in other lanes.
  3. `WORKTREE CLEAN → REASSIGN` — `git status` shows `clean`, ticket teleports to idle `mock-1`, lane re-brightens.
- **VO:** "When something stalls, hits a rate limit, or fails repeatedly, Crewel can pause, freeze, or safely reassign work instead of letting the whole team get stuck." (0:50.2–0:58.4)
- **SFX:** flatline thud, rate-limit buzz (subtle, not harsh), clean reassignment whoosh — all 30% below VO.
- **Transition:** hard cut on reassigned ticket landing, 120ms.

### Scene 7 — BOARD COMES TOGETHER — 0:59–1:10 (11.0s)

- **Visual:** Wide zoom-out from panes to full board: `CREWEL / DEMO` header + counts `OPEN 0 · ASSIGNED 0 · IN-PROGRESS 0 · NEEDS-CLARIFICATION 0 · IN-REVIEW 0 · BLOCKED 0 · DONE 3`. All three tickets in `DONE`. Lead avatar reviews — checkmarks `✓ auth-schema · ✓ login-route · ✓ login-tests` tick 180ms stagger. Branch convergence animates: three `teammate/*` lines merge into `crewel/demo/integration` (dot swell), then that line merges into `main` (second swell, greenish-white flash at 8% opacity). Show `main moved` only now.
- **VO:** "The result isn't a collection of disconnected agents. It's one engineering workflow, from request to reviewed code." (0:59.2–1:09.4)
- **SFX:** three check ticks, two merge swells (low thuds).
- **Transition:** branch line traces down into filesystem tree, dissolve 260ms.

### Scene 8 — HUMAN-READABLE STATE — 1:10–1:17 (7.0s)

- **Visual:** Close-up of `.crewel/` tree inside glass pane (JetBrains Mono, 12px):
  ```
  .crewel/
  ├── teams/demo/config.json
  ├── tickets/auth-schema.json
  ├── tickets/login-route.json
  ├── state/board.json
  └── mail/lead.jsonl
  ```
  File opens (`auth-schema.json`): `{ "id": "auth-schema", "status": "done", "assignee": "opencode-1", "acceptance": ["users table exists", "session store handles expiry"] }` — human-readable, no minification. `jason.log` tail at bottom: `tail -f .crewel/.../jason.log`.
- **VO:** "And the entire state lives in your repository as human-readable JSON and Markdown." (1:10.2–1:16.6)
- **HUD:** `No black box.` → `Just inspectable state.` (swap 900ms apart)
- **SFX:** file-open click, soft paper rustle.
- **Transition:** tree fades to threads, scale 1.02→1, 260ms.

### Scene 9 — FINAL HERO SHOT — 1:17–1:30 (13.0s)

- **Visual:** Three threads (white / clay / hairline) converge into the favicon X (140px, white at 92%) with subtle embroider hatching around it — 1.1s draw + fill. `CREWEL` locks 72px Schibsted 600, -0.035em. Tagline 16px .55: `A mixed crew of coding agents, stitched together on one ticket board.` Then lower lockup 11px mono caps .34: `OpenCode · Claude Code · Codex — Agent-agnostic. · Ticket-driven. · Built for real engineering teams.` Final frame holds 3.2s (poster frame).
- **VO:** "Crewel. Different agents. One team." (1:17.4–1:24) + 5s music tail holds under final tag.
- **SFX:** final logo hit (low, warm), tail silence.
- **End card:** hold poster frame for share thumbnail bake.

**Total: 8 + 8 + 11 + 13 + 10 + 9 + 11 + 7 + 13 = 90.0s** — within 77–90s with VO ducting; trims to 85s if narration pace allows (tighten Scene 4→5 gap by 2s).

---

## 6. Motion, timing, and readability system

- **Reading floors enforced:** Single HUD line 1.0–1.6s held; sentence HUD 1.8–2.2s; ticket card titles 1.2s minimum before board move resumes.
- **VO-led holds:** No line of text exits before its VO sentence completes. If VO overruns a scene by ≤0.6s, extend glass hold; if >0.6s, trim SFX gap, never VO.
- **Grid snapping:** Major reveals (Scene 2 CREWEL, Scene 7 merge swells, Scene 9 X) land ±0.15s of a strong music cue. Ticket triads and parallel ticks snap ±0.10s to beat grid; sequential text holds every other beat if tempo >110 BPM.
- **Motion tokens:** `--enter: 420ms ease-out(0.25,0.46,0.45,0.94)`; `--micro: 160ms ease-out`; `--cam: 520ms easeInOut`; `--hold-short: 800ms`; `--hold-sentence: 2000ms`.
- **Poster frame:** Scene 9 at `T = 86.5s` (X + CREWEL + tagline fully settled, no transient). Bake as frame 0 for idle thumbnail + `brag.jpg`.

---

## 7. Audio plan (music + VO + SFX)

- **Musicbed:** Cinematic infrastructure bed, 82–92 BPM, minor, muted kick + sub, soft arpeggiated keys. No obvious drop — this is an engineering film, not a hype trailer. Volume: bed at -18 LUFS, VO duck to -22 LUFS. Final 5s: music returns to -14 to carry the logo hold, then 1.2s fade.
- **Bundled candidate if Hyperframes bed missing:** `happy-beats-business-moves-vol-9/10/11/12` — pick the lowest-swell variant at composition; prioritize 90bpm with a clear bar 1 hit at ~8s and ~59s for Scene 2/7 locks. Long duration will require _two concatenated beds_ or a single 90s bed supplied by Hyperframes — note in `composition-brief.md` to obtain/create a 90s cinematic bed if bundled tracks are 15–25s editorial cuts.
- **SFX palette (sparse):** keyboard ticks (interface), `card-slide-1/3` for ticket moves, `chip-lay-2 / chips-stack-1` for board ticks (muted), interface plucks for mail, low thuds for merges, thread tension ticks (use `sfx-analysis.md` low-risk picks for repeated moments). SFX never louder than VO.
- **Audio-reactive (subtle):** If Hyperframes extracts RMS/bands, wire to: glass glow opacity (±6%), thread width (±0.3px), HUD title tracking (±1px). No waveform/particles/strobe.

---

## 8. Hyperframes implementation outline

### Canvas

```
1920 × 1080, 30fps, export H.264 mp4, single composition, 9 scenes as <section data-scene> with data-start/duration; unified audio track.
```

### Composition contract

- `brag-output/composition/` — Hyperframes project (native conventions own structure/animator choices)
- `brag-output/composition/assets/music/` — 90s cinematic bed + any Kokoro VO wavs
- `brag-output/composition/assets/sfx/` — selected SFX copies
- `brag-output/brag.mp4` — 90s master render
- `brag-output/brag.jpg` — poster frame baked as frame 0
- `brag-output/share-copy.txt` — share line

### Gate

- `npx hyperframes check` passes zero errors. With 90s duration, the 15–25s lint must be waived — plan documents this as intentional launch-film length (script + product story require it). If Hyperframes enforces a hard cap, emit into `brag-output-2026-08-28-xxxxxx/` with duration override flag per `references/step-3-compose.md`.

### What Hyperframes decides (not this plan)

Concrete DOM/GSX structure, exact keyframe curves, choice of SFX filenames, RMS extraction wiring, blur/saturation stack values, blur-vs-transform tradeoffs, subtitle burn-in vs caption track.

---

## 9. Freshness / failure modes designed out

- **First 3s reads as devtool:** Scene 1 opens on `lead>` prompt typing `docs/spec.md` — no logo preamble. By 2.1s the viewer knows this is a developer tool.
- **Split risk (single request → many tickets) is the visual hook** at 0:06–0:08 single-terminal → three-glass-cards — the one shot a scroller screenshots.
- **Hero moment (parallel work) is unmistakable:** 3 simultaneous terminals + branch graph convergence is the most rewatchable 13s; poster comes from the _end_, not the hero, so both moments are distributed.
- **No stock/hologram/neon:** All geometry is glass + 1px white lines at 22–45% opacity. Neon rule: never above 50% saturation white on dark.
- **Scorecard legible at 1080p and when recompressed to 720p:** Ticket ids at 28–32px in film scale (not 11px as on site) — rewrapped for video. Close-up on `.crewel/` file at 18–20px mono, line-length ≤42 chars.
- **Long VO:** 11 sentences must not run continuous — music gaps between Scene 5→6 and 7→8 let the mix breathe.

---

## 10. Deployment into `site/index.html`

The landing's `<video id="hfVideo">` already HEAD-checks `brag-output/brag.mp4` candidates and swaps the mock terminal. On render completion:

- Copy/ensure `site/brag-output/brag.mp4` or root `brag-output/brag.mp4` exists at one of the three checked paths.
- Keep `poster` baked as frame 0 — `site/index.html` handles `playsinline controls muted loop` presentation.

---

_End of plan. Next artifact: `brag-output/composition-brief.md` (Hyperframes contract) + `brag-output/brag-plan.md` (condensed rubric pass), then composition build._
