# Hyperframes Composition Brief: Crewel

## Objective

Create a script-locked cinematic launch film for **Crewel — "A mixed crew of coding agents, stitched together on one ticket board."** This is not the default 15–25s brag template. The user-provided 9-scene / 90s script + verbatim voiceover is the contract. Hyperframes must realize it at 1920×1080, 16:9, dark infrastructure aesthetic, with readable terminal/branch/board motion and a thread-weave metaphor.

## Output

- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4` (also `site/brag-output/brag.mp4` for Pages probe)
- Poster: `brag-output/brag.jpg` (Scene 9 at ~86.5s, baked as frame 0)
- Format: **landscape — 1920×1080**
- Duration: **90.0s (85–90s acceptable; trimmable by tightening Scene 4→5 gap by 2s) — intentional override of the 15–25s brag lint**
- FPS: 30 (render), 24fps feel acceptable

## Source Material

- Project root: `/Users/jasonamadi/crewel`
- Primary files read: `site/index.html` (full liquid-glass system), `site/favicon.svg` (X-stitch), `site/COPY.md`, `site/assets/*` (real marks), `README.md`, `PRODUCT.md`, `docs/PRD.md`, `docs/DECISIONS.md`, `DESIGN.md`
- Product name: **Crewel** (crewel embroidery = many threads, one fabric)
- Tagline / strongest claim: **"A mixed crew of coding agents, stitched together on one ticket board."**
- Key UI/visual moments to recreate verbatim:
  1. `lead> Add a login flow per docs/spec.md` prompt + `One request.` / `A lot of work.` HUDs
  2. Glass tickets `AUTH-SCHEMA / LOGIN-ROUTE / LOGIN-TESTS` with acceptance and `→ OpenCode / Claude Code / Codex`
  3. Three parallel `teammate/*` terminals (isolated worktrees) + branch graph `main → crewel/demo/integration → teammate/opencode-1|claude-1|codex-1` with `main untouched`
  4. Live board columns `OPEN → ASSIGNED → IN-PROGRESS → NEEDS-CLARIFICATION → IN-REVIEW → BLOCKED → DONE` with mail `claude-1 → lead` + `codex-1 → lead — Should failed login attempts be rate limited?`
  5. Resilience flashes `STALL DETECTED → AUTO-PAUSE`, `RATE LIMIT → PAUSED`, `WORKTREE CLEAN → REASSIGN`
  6. `CREWEL / DEMO — DONE 3` + `✓ auth-schema / login-route / login-tests` → branch merge `→ integration → main`
  7. `.crewel/` filesystem tree + readable JSON/Markdown file
  8. Final X-stitch (favicon `M11 11 L21 21 M21 11 L11 21` + 2.4px dot at 140px) → `CREWEL` wordmark + closing taglines
- Copy that must appear verbatim: every line listed in `brag-output/crewel-hyperframe-plan.md §3` — do not paraphrase. Voiceover script (11 paragraphs, see plan §3) is the audio verbatim source.

## Creative Direction

- Tone preset: **cinematic** mapped to _premium developer infrastructure_ — Linear calm + Vercel terminal severity. Dry, senior-engineer, engineer-to-engineer. Not chaotic, not parody, not generic SaaS.
- Creative direction: _Linear meets Vercel with an embroidery thread — a dark, confident launch film that shows real terminal work instead of AI sparkle._
- Interpretation: Longer holds than default brag (4–13s scenes), medium-fast camera (scale 1.04–1.08, 4–8px drift), clean cuts (120ms) or dissolves (260ms), thread draws 700ms, type slams with holds that satisfy reading floors (0.8s label, 0.3s/word sentence, no line exits before VO ends), glass depth + specular sweep + 2% grain + 1% vignette throughout.
- Angle: The embroidery film — three threads woven into one fabric on one board — proof is the parallel hero and the convergence, not hype.
- Hook: Cursor typing `Add a login flow per docs/spec.md` alone in a glass terminal → `One request.` → single-to-three ticket fracture. By 2.1s the viewer knows this is a developer tool; by 8s they know the value proposition.
- Outro / punchline: X-stitch convergence → `CREWEL` → `A mixed crew…` → `OpenCode · Claude Code · Codex — Agent-agnostic. Ticket-driven. Built for real engineering teams.` — voice lands `Crewel. Different agents. One team.` — 3.2s poster hold.
- Avoid: generic robot/AI imagery, humanoid robots, excessive neon, fake holograms, stock footage, overly complicated UI, marketing buzzwords without showing product, walls of meaningless code, color beyond the void/white/thread system.

## Visual Identity

- Background: `#050505` void + two radial washes `42% 32% at 70% -5% rgba(255,255,255,0.07)` and `30% 26% at 8% 30% rgba(255,255,255,0.035)` + glass `rgba(255,255,255,0.055) | border rgba(255,255,255,0.10) | blur 24–30px saturate(1.1) | inner highlight rgba(255,255,255,0.12)` — extracted from `site/index.html :root`
- Text: `rgba(255,255,255,0.92)` primary / `0.55` secondary / `0.34` tertiary — identical to site
- Accent: **none added** — white only at varying opacity (threads at 22–45%). Provider pills only inside 42px glass circles at one occurrence: opencode #201D1D on #FFFFFF, claude #D97757 on rgba(217,119,87,0.14), openai #000 on #FFFFFF, mock monochrome
- Display font: **Schibsted Grotesk** 400/500/600 (Google Fonts as in site; fallback Inter/system-ui, tracking -0.035em for hero titles)
- Body/mono font: **JetBrains Mono** 400/500 — all terminal/code/tags/board labels; re-wrapped for video (HUD 18–26px, board ids 28–32px in film scale, file view 18–20px, line-length ≤42 chars) so reads at 720p recompression
- Radius tokens: `--r-lg 28px / --r-md 18px / --r-pill 999px` — inherited
- Visual references from project: glass pane + specular sweep + pane bar, mock terminal (`$ crewel init → lead> … → ✓ decomposed…`), row/roster pills, `warp`-like branch graph, filesystem tree typography. No illustration layer.

## Storyboard

Use `brag-output/brag-plan.md` as creative contract and `brag-output/crewel-hyperframe-plan.md §5` as the frame-accurate lock. Summary:

1. **Scene 1 — THE PROBLEM — 8.0s** — dark terminal typing → `One request.` → `A lot of work.` → split into 3 ghost tickets — type ticks + whoosh
2. **Scene 2 — INTRODUCE CREWEL — 8.0s** — `CREWEL` lockup + subtitle, 3 agent pills enter with threads weaving into one pane → `One team. One board.` — card clicks
3. **Scene 3 — LEAD DECOMPOSES — 11.0s** — `lead>` fractures into 3 tickets with acceptance + `→ OpenCode/Claude/Codex` — typing + fracture + clicks
4. **Scene 4 — PARALLEL EXECUTION (HERO) — 13.0s** — 3-way glass workspaces with isolated terminals + branch graph `main → integration → teammate/*` + HUDs — layered typing + git/test ticks
5. **Scene 5 — AGENTS COMMUNICATE — 10.0s** — board column slides + two mail toasts + `NEEDS-CLARIFICATION` detour — card-slides + mail plucks
6. **Scene 6 — RESILIENCE — 9.0s** — 3 vignettes `STALL→AUTO-PAUSE / RATE LIMIT→PAUSED / WORKTREE CLEAN→REASSIGN` — thud/buzz/whoosh
7. **Scene 7 — BOARD COMES TOGETHER — 11.0s** — `DONE 3` + checkmarks + branch merge `→ integration → main` — ticks + merge thuds
8. **Scene 8 — HUMAN-READABLE STATE — 7.0s** — `.crewel/` tree + opened `auth-schema.json` + `jason.log` — file click + rustle
9. **Scene 9 — FINAL HERO — 13.0s** — threads converge into 140px X-stitch → `CREWEL` + taglines, 3.2s poster hold — warm logo hit

**Grand total 90.0s.** Reading floors enforced per plan §6; VO-led holds (no text exits before its sentence ends); strong-cue locks at ~8s / ~59s / ~78s.

## Audio

- Audio role: low cinematic bed that ducks under VO; sparse motion-matched accents — infrastructure, not hype.
- Audio arc: bed rises 0–8s under Scene 1, ducks -22 LUFS through VO blocks, breathes in Scene 5→6 and 7→8 gaps, returns to -14 for final 5s logo hold, 1.2s tail fade.
- Music: **90s cinematic bed required** — muted sub + soft perc/keys, 82–92 BPM, minor, no obvious drop. The bundled `happy-beats-business-moves-vol-9…12` cuts are 15–25s editorial only and must not be used as the sole bed for a 90s film unless concatenated with clean bar continuity. Prefer a single 85–90s bed (supply or generate at composition). If concatenating, crossfade at bar boundaries, not mid-phrase.
- Music treatment: bed -18 LUFS, duck to -22 during VO, return to -14 for last 5s; 260ms fades on scene dissolves, 120ms cuts stay hard. Let final logo hit ring over bed tail.
- Music cue guidance: bundled cues are for short cuts — at composition run `analyze_music_cues.py` (if Python available) or `npx hyperframes beats` (Hyperframes ≥0.6.99) on the _chosen 90s bed_ to obtain `strongCues` + `beats`. Guidance: lock **1–3 strong cues** within ±0.15s of major reveals (8s CREWEL, 59s merge swell, 78s X). Snap ticket/branch/parallel ticks within ±0.10s of beat grid; for sequential TEXT, snap to every other beat if beats are <0.6s apart, otherwise hold full set after quick reveal (prevents rushed spec rows). Treat cues as optional — readability and VO pacing are primary.
- Audio-reactive treatment: **subtle only** — if Hyperframes extracts RMS/bands, wire to glass glow ±6%, thread width ±0.3px, HUD tracking ±1px. No waveform/equals, no musical-note graphics, no particle system, no strobing / heavy pulsing.
- Audio-coupled moments:
  - Scene 1 typing — keyboard ticks
  - Scene 2 pill reveals / thread draw — card-place (low-risk picks per `sfx-analysis.md`)
  - Scene 3 fracture + assignments — fracture tick + card-slide
  - Scene 4 parallel typing — three layered typing tracks + git/test ticks
  - Scene 5 board slides + mail — card-slide per column + interface plucks for `[mail]`
  - Scene 7 checkmarks + merges — chips/stack ticks + low merge thuds
  - Scene 9 logo — single warm logo hit
- SFX selection guidance: motion-matched, sparse, restrained; card sounds for card reveals, key/click for typing, short pluck/bell for mail, low thud for merges. Use `assets/sfx/sfx-analysis.md` to prefer low high-frequency-risk files for repeated moments (typing/boards). Density stays sparse where VO is dense.
- SFX analysis guidance: `~/.claude/skills/brag/assets/sfx/sfx-analysis.md` (+ `.json`) at composition — prefer lower-risk files for Scene 4/5 repeated events.
- Exact SFX choice: Hyperframes chooses filenames, timestamps, density, volume based on implemented animation — `/brag` guidance is not a fixed cue sheet.
- Audio files: copy the chosen 90s music bed (and any Kokoro VO wavs, if narrated variant is built) into `brag-output/composition/assets/music/` (and `assets/voiceover.wav`). SFX copies go to `assets/sfx/` after selection.

## Hyperframes Instructions

Load the composition-building Hyperframes domain skills — `hyperframes-core` (composition contract + `data-*` timing), `hyperframes-animation` (motion), `hyperframes-creative` (design spec, beats, audio-reactive), `hyperframes-keyframes` (seek-safe keyframes), and `hyperframes-cli` (lint/check/render). **/brag is its own workflow: do not enter the `hyperframes` entry-point intent interview or route into its generic promo / launch-video workflow.** Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:

- Show at least one real UI, copy, and visual element from the source project — this film shows _five_ (terminal prompt, board, branch graph, filesystem, glass container + X stitch).
- Keep all text readable in the final render — re-wrapped for 1080p and 720p recompression, with reading floors enforced; scene holds extend if VO overruns.
- Duration note: **The 15–25s lint is intentionally waived for this launch film.** The user's script, product story, and voiceover require 77–90s. Emit `brag-output/brag.mp4` at 90s and log the override in lint output; or emit into timestamped `brag-output-YYYY-MM-DD-HHmmss/` with `--duration 90` if the checker requires a scalar override.
- Include the music + sparse SFX layer; treat music cue metadata as optional hints (1–3 strong locks, beat-grid for small events); ignore any cue that hurts readability or story.
- Honor ducking/fade treatment around voiceover (0.12–0.15 duck if a narrated variant is produced; same duck for music bed under on-screen text pacing even without VO).
- Honor audio-reactive as subtle brand texture if extraction is available; skip if `ffmpeg` or helper is missing — do not block render.
- Use local assets for audio and runtime deps when possible.
- Run `npx hyperframes check` before render — it is brag's single gate (with the documented duration override). Render only after check passes.
