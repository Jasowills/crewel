# Brag Plan: Crewel

## What is this app?

Crewel stitches OpenCode, Claude Code and Codex into one coordinated engineering team — one lead turns a request into tickets, teammates execute in isolated git worktrees, everything lives as readable JSON/Markdown on one board.

## The angle

The _embroidery_ film. Three differently-colored threads (OpenCode / Claude Code / Codex) are woven into one fabric — not three tabs, one board. The film earns distinctiveness by _showing real engineering work_ (typing `lead> Add a login flow per docs/spec.md`, parallel terminals with `git checkout -b crewel/demo/auth-schema`, a board whose columns actually slide `open → done`, a filesystem you can `cat`) rather than AI sparkle. Liquid-glass dark infrastructure is the texture; threads are the memory.

## Hook (first 2-3 seconds)

Dark glass terminal, cursor typing `Add a login flow per docs/spec.md`. Pause — the request sits alone. Fade in: `One request.` This is immediately a developer tool; the hook is the _loneliness_ of an undecomposed request.

## Key moments (the middle)

- **The split (0:06–0:08):** One request fractures into `AUTH-SCHEMA / LOGIN-ROUTE / LOGIN-TESTS` — three glass tickets sliding from center. The single most postable 2 seconds.
- **Parallel hero (0:27–0:40):** Three terminals _simultaneously_ running `git` / file diffs / tests in three `teammate/*` worktrees over the branch graph `main → crewel/demo/integration → teammate/opencode-1 | claude-1 | codex-1` with `main untouched` — the proof of isolation.
- **Clarification over guessing (0:40–0:50):** `codex-1 → lead — Should failed login attempts be rate limited?` — ticket moves to `NEEDS-CLARIFICATION` and back. The senior-engineer bar made visible.

## Outro / punchline

Three threads converge into the favicon X (embroidered white X), then `CREWEL — A mixed crew of coding agents, stitched together on one ticket board. — OpenCode · Claude Code · Codex — Agent-agnostic. Ticket-driven. Built for real engineering teams.` Hold 3.2s. Voice: `Crewel. Different agents. One team.`

## User flow worth showing

`lead> Add a login flow per docs/spec.md` → lead decomposes into tickets with assignee + acceptance → three isolated worktrees in parallel → live board + mail clarification → stall/rate-limit auto-pause resilience → DONE 3/3 → lead review → converge into `crewel/demo/integration` → merge to `main` → inspect `.crewel/` JSON/Markdown → stitched hero. One linear engineering workflow, end to end.

## Tone

- Preset: cinematic
- Creative direction: "Linear calm meets Vercel terminal — a premium, dry, engineer-to-engineer launch film told in glass and threads"
- Interpretation: Longer holds than a typical brag (4–13s scenes), medium-fast camera, clean cuts/dissolves, type slams that **hold**, white-only thread lines (no neon), music that supports VO rather than competing with it.

## Format: landscape — 1920x1080

## Duration: 90 seconds (script-locked; 77–90s contract; build targets 90.0s, trimmable to 85s by tightening Scene 4→5 gap)

## Visual identity (from the project)

- Background: #050505 (void) + rgba(255,255,255,.06) glass at blur 24–30 + inner stroke rgba(255,255,255,.12)
- Accent: white only (no hue); provider pills use real brand colors only inside 42px circles (opencode #201D1D on white, claude #D97757 on clay tint rgba(217,119,87,.14), openai #000 on white)
- Text: rgba(255,255,255,.92) primary / .55 secondary / .34 tertiary
- Display font: Schibsted Grotesk 400/500/600 — Body font: JetBrains Mono 400/500
- Strongest visual element: Three parallel agent terminals + the branch graph converging, and the final X-stitch

## Share copy (draft)

Crewel — different agents, one team. OpenCode + Claude Code + Codex on one ticket board. npm install -g crewel

## Audio direction

- Role: low cinematic bed that ducks under voiceover; sparse motion-matched accents
- Music: muted pulsing sub + soft perc/keys, 82–92 BPM, minor; bundled catalog lacks a 90s cinematic bed — use a 90s bed supplied or concatenate; initial candidates `happy-beats-business-moves-vol-9…12` only if a remix is needed
- Music treatment: bed at -18 LUFS, duck to -22 during VO, return to -14 for final 5s logo hold then 1.2s fade
- Music cue guidance: bundled cues are editorial 15–25s cuts — detect at composition via `analyze_music_cues.py` or `npx hyperframes beats` on the chosen 90s bed; strongCue locks at ~8s (CREWEL reveal), ~59s (merge swell), ~78s (X stitch)
- Audio-reactive treatment: subtle — glass glow ±6%, thread width ±0.3px; no waveform/particles/strobe
- SFX posture: sparse / motion-matched — keyboard ticks, card-slide, interface mail pluck, merge thuds
- Audio-coupled moments: Scene 1 typing; Scene 2 pill reveals; Scene 3 ticket fracture; Scene 4 overlapping typing; Scene 5 board slides + mail; Scene 7 merge swells; Scene 9 logo hit
- Restraint rule: SFX never louder than VO; no whooshes, no neon sound design; readability + VO clarity are primary

## Voiceover script

> Software doesn't get complicated because one engineer can't solve it. It gets complicated because there's a lot to solve at once.
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
> Crewel.

## Storyboard

### Scene 1 — THE PROBLEM — 8.0s

Dark terminal in glass pane stages `Add a login flow per docs/spec.md` typing, then `One request.` / `A lot of work.` then the request splits into three ghost ticket cards.
Sequential/interaction: yes — typing simulation (0.6s), two HUD swaps, 3-card fracture 160ms stagger
Audio intent: quiet bed, curiosity
Audio-coupled idea: keyboard ticks for typing, soft whoosh for split
Music: low cinematic bed
Transition mood: dissolve 260ms via thread growth → Scene 2

### Scene 2 — INTRODUCE CREWEL — 8.0s

`CREWEL` 84px lockup + subtitle, three agent pills (real marks, real brand pill colors) enter and threads weave into one pane edge; lockup `OpenCode + Claude Code + Codex → One team. One board.`
Sequential/interaction: yes — CREWEL fade/scale 440ms, 3 pills 140ms stagger, thread draw 700ms
Audio intent: confidence building
Audio-coupled idea: three card-place clicks + thread ticks
Transition mood: cut 120ms → Scene 3

### Scene 3 — LEAD DECOMPOSES — 11.0s

`lead>` prompt fractures into `AUTH-SCHEMA / LOGIN-ROUTE / LOGIN-TESTS` cards with acceptance lines; assignment arrows `→ OpenCode / Claude Code / Codex` draw.
Sequential/interaction: yes — analysis pulse, 3-card fracture, 3 assignment draws 380ms each
Audio intent: clarity, exposition
Audio-coupled idea: typing + fracture tick + assignment clicks
Transition mood: slide 260ms (cards become Scene 4 panes) → Scene 4

### Scene 4 — PARALLEL EXECUTION (HERO) — 13.0s

Three-way glass workspaces with independent terminals (`git checkout -b`, `rg`, `npm test`, diffs) + lower branch graph `main → crewel/demo/integration → teammate/opencode-1 | claude-1 | codex-1` + HUDs `Parallel execution. / Isolated worktrees.`
Sequential/interaction: yes — three terminals type at different phases, graph fades at 0:33 with pulse
Audio intent: kinetic, impressive — dense but not chaotic
Audio-coupled idea: three layered typing tracks + git click + test pass ticks
Transition mood: dissolve 260ms (panes collapse to board) → Scene 5

### Scene 5 — AGENTS COMMUNICATE — 10.0s

Live board with column slides `OPEN→ASSIGNED→IN-PROGRESS→IN-REVIEW→DONE`; two mail toasts (`claude-1 → lead — Ready for review`, `codex-1 → lead — rate limit?`) and `NEEDS-CLARIFICATION` detour with lead answer.
Sequential/interaction: yes — column moves 420ms stagger 160ms, mail pop-ins, board flash
Audio intent: conversational, coordinated
Audio-coupled idea: card-slide per column move + two mail plucks
Transition mood: micro-zoom 1.04, cut → Scene 6

### Scene 6 — RESILIENCE — 9.0s

Fast montage: `STALL DETECTED → AUTO-PAUSE` / `RATE LIMIT → PAUSED` / `WORKTREE CLEAN → REASSIGN` — each 2.7s vignette over board.
Sequential/interaction: yes — three vignettes equal split, flatline + buzz + reassignment whoosh
Audio intent: tension then resolve
Audio-coupled idea: flatline thud, rate-limit buzz, whoosh
Transition mood: hard cut 120ms → Scene 7

### Scene 7 — BOARD COMES TOGETHER — 11.0s

Zoom-out to full board `DONE 3`, checkmarks tick `✓ auth-schema / login-route / login-tests`, three teammate branches merge → `integration` → `main` with dot swells.
Sequential/interaction: yes — board reveal, 3 check ticks 180ms stagger, two merge swells
Audio intent: payoff, coming together
Audio-coupled idea: check ticks + two low merge thuds
Transition mood: dissolve 260ms (branch traces to filesystem) → Scene 8

### Scene 8 — HUMAN-READABLE STATE — 7.0s

Close-up `.crewel/` tree + opened `auth-schema.json` readable `{ id, status: done, assignee, acceptance }` + `jason.log` tail; HUDs `No black box. / Just inspectable state.`
Sequential/interaction: yes — file tree fade, file open click, `jason.log` tail
Audio intent: calm, trust-building
Audio-coupled idea: file-open click + paper rustle
Transition mood: dissolve 260ms → Scene 9

### Scene 9 — FINAL HERO SHOT — 13.0s

Three threads converge into favicon X (140px), reveal `CREWEL` wordmark + tagline pair, hold 3.2s poster frame.
Sequential/interaction: yes — thread draw 1.1s, X fill, wordmark lock, tagline fade
Audio intent: resolution, premium hold
Audio-coupled idea: final warm logo hit
Transition mood: hold → end card (no exit)

**Music mood for this video:** cinematic, muted, confident — infrastructure not hype
**Audio summary:** Low pulsing bed that ducks under dry, confident VO, with sparse card/keyboard/mail/merge accents marking state changes; thread/branch motion stays legible over the pulse; final logo hold returns music to foreground before a 1.2s fade.

**Reading-time compliance:** Every HUD line holds ≥0.8–1.6s settled; every sentence ≥2.0s; no line exits before its VO sentence ends. Scene totals sum to 90.0s; trimmable to 85s without touching readability.
