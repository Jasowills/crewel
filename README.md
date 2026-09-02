# crewel

[![npm version](https://img.shields.io/npm/v/crewel.svg)](https://www.npmjs.com/package/crewel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun >=1.3](https://img.shields.io/badge/bun-%3E%3D1.3-black.svg)](https://bun.sh) [![Node >=26.4 --experimental-ffi](https://img.shields.io/badge/node-%3E%3D26.4%20--experimental--ffi-yellow.svg)](https://nodejs.org/api/ffi.html)

> A mixed crew of coding agents, stitched together on one ticket board.

Like crewel embroidery — many differently-colored threads worked into a single
fabric — Crewel stitches heterogeneous coding agents (OpenCode, Claude Code,
Codex) into one coordinated team: a dedicated lead decomposes work into
tickets, teammates execute them independently in isolated git worktrees, and
everyone coordinates through a shared, human-readable state layer with live
notifications.

**Why Crewel?** Existing multi-agent tools are single-vendor (Claude Code teams run only Claude, Gas Town runs only one type). Crewel is agent-agnostic — an OpenCode teammate can work alongside a Claude Code teammate and a Codex teammate on the same board, with the same protocol. Every teammate is configured as a senior/principal engineer: it pushes back on unclear tickets via `needs-clarification` instead of guessing.

**Features**

- **Cross-agent teams** — mix OpenCode, Claude Code, Codex (or `mock` for dry runs) in one team
- **Ticket-driven, not todo-list** — status, assignee, dependencies, acceptance criteria; `needs-clarification` is a first-class state
- **Isolated worktrees** — `crewel/{team}/integration` + per-teammate branches; `main` is never touched until close-out
- **Live push, not poll** — `team watch` streams board/mail/`jason.log` via `fs.watch`
- **Resilient** — interrupt, stall watchdog, rate-limit auto-pause, freeze after 3 failures, hybrid reassign only on clean worktrees
- **Human-readable state** — everything under `.crewel/` is `cat`-able JSON/Markdown

## Quickstart

```sh
# Install — TUI needs Bun >=1.3.0 (OpenTUI FFI), or Node >=26.4 with --experimental-ffi
bun add -g crewel        # recommended: bunx crewel / bun --bun crewel
# or: npm install -g crewel  # non-TUI commands work on Node >=20; TUI falls back to console
# or: npm install -g crewel && NODE_OPTIONS="--experimental-ffi --allow-ffi" crewel  # Node 26.4+ TUI

# In a git repo with at least one commit — interactive setup
crewel init
# Team name [my-app]: demo
# How many mock teammates? (0-5) [0]: 2
# How many opencode teammates? (0-5) [0]: 0
# How many claude-code teammates? (0-5) [0]: 0
# How many codex teammates? (0-5) [0]: 0
# Pick team lead / orchestrator (mock, opencode, claude-code, codex) [mock]: mock
# ✓ team "demo" ready

# Or non-interactive:
crewel team create demo --lead mock --teammates mock:2
# created team "demo"
#   lead:      mock
#   teammates: mock-1 (mock), mock-2 (mock)

# Author tickets as Markdown with YAML frontmatter
mkdir -p .crewel/teams/demo/tickets
cat > .crewel/teams/demo/tickets/hello.md <<'MD'
---
id: hello
title: Create hello.txt
accepts:
  - hello.txt exists containing hello
---
Create hello.txt in the repo root with content exactly: hello
MD

crewel tickets validate
# ✓ 1 ticket(s) valid — JSON twins updated

crewel ticket assign hello --to mock-1
# ✓ hello assigned to mock-1

crewel teammate tick mock-1
# mock-1: completed (done) — hello

crewel team tickets
# ticket board for "demo"
#   open: (empty)
#   assigned: (empty)
#   in-progress: (empty)
#   needs-clarification: (empty)
#   in-review: (empty)
#   blocked: (empty)
#   done:
#     - hello Create hello.txt (mock-1)

crewel team status
# team "demo" (active)
#   lead:      mock
#   teammates: mock-1 (mock), mock-2 (mock)
#   board:     open 0 · assigned 0 · in-progress 0 · needs-clarification 0 · in-review 0 · blocked 0 · done 1
```

Launch the team — 6 panes via OpenTUI + node-pty/Bun.spawn (Bun ≥1.3.0 for TUI, Node ≥26.4 --experimental-ffi, fallback to console on Node 20-24):

```sh
crewel
# Launching crewel team "demo"
#   lead:      mock (focused)
#   teammates: mock-1 (mock), mock-2 (mock)
# Layout: lead 58% left (focused) | teammates 2+2+1 grid right
# Tip: start prompting the lead. Other panes will stream live.

# In the lead pane, type a request:
# lead> Add a login flow per docs/spec.md
# ✓ decomposed into 3 tickets: auth-schema, login-route, login-tests
# The lead delegates, reviews, and pushes — you just prompt the lead.

# If no team exists, crewel prompts to init:
# No crewel team found in this repo.
# Run "crewel init" to set up your team (lead, teammates, sizes).
```

Direct mode above bypasses the lead. For the headline experience, let the lead decompose a request:

```sh
crewel team run --request "Add a login flow per docs/spec.md"
# ✓ decomposed into 3 tickets: auth-schema, login-route, login-tests
```

Live board and notifications (also visible inside the launched UI):

```sh
crewel team watch
# watching "demo" — Ctrl-C to stop
# [board] ticket state changed
# [mail] new mail for mock-1
```

## Commands

Public:

```
crewel init                           # interactive setup
crewel                                # launch team UI (6 panes, lead focused)
crewel team status [name]
crewel team watch [--team <name>]
```

All commands exit `0` on success, `1` on usage or domain errors with an actionable `error:` line. Run `crewel --help` for details. The lead handles `assign`, `tick`, `review`, and `push` internally — you just prompt the lead.

<details>
<summary>Internal protocol (for lead/tools and tests)</summary>

```
crewel team create <name> --lead <type> --teammates <type>:<count>,...
crewel team run --request "..." [--team <name>]
crewel team archive [--team <name>]
crewel team closeout [--team <name>]
crewel team stop [--team <name>] [--now]
crewel team start [--team <name>]
crewel team check-stalls --older-than-ms <ms>
crewel team tickets [--team <name>]
crewel tickets validate [--team <name>]
crewel ticket assign <id> --to <teammate>
crewel ticket clarify <id> --answer "..."
crewel ticket unfreeze <id>
crewel teammate tick <id>
crewel teammate interrupt <id>
crewel teammate pause <id> --reason "..."
crewel teammate resume <id>
```

Hidden from `crewel --help`; use `crewel _internal --help` to see them.
</details>

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — original hand-off spec (written under the placeholder name "Motley")
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — grill-session decision log (every resolved design question)
- [`docs/PRD.md`](docs/PRD.md) — product requirements for v1

## License

MIT — see [LICENSE](LICENSE).
