# crewel

> A mixed crew of coding agents, stitched together on one ticket board.

Like crewel embroidery — many differently-colored threads worked into a single
fabric — Crewel stitches heterogeneous coding agents (OpenCode, Claude Code,
Codex) into one coordinated team: a dedicated lead decomposes work into
tickets, teammates execute them independently in isolated git worktrees, and
everyone coordinates through a shared, human-readable state layer with live
notifications.

## Quickstart

```sh
# Install (requires Node >=20)
npm install -g crewel

# In a git repo with at least one commit
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

Direct mode above bypasses the lead. For the headline experience, let the lead decompose a request:

```sh
crewel team run --request "Add a login flow per docs/spec.md"
# ✓ decomposed into 3 tickets: auth-schema, login-route, login-tests
```

Live board and notifications:

```sh
crewel team watch
# watching "demo" — Ctrl-C to stop
# [board] ticket state changed
# [mail] new mail for mock-1
```

## Commands

All commands are `crewel <group> <action>` and exit `0` on success, `1` on usage or domain errors with an actionable `error:` line.

```
crewel team create <name> --lead <type> --teammates <type>:<count>,...
crewel team status [name]
crewel team tickets [--team <name>]
crewel team watch [--team <name>] [--desktop]
crewel team run --request "..." [--team <name>]
crewel team archive [--team <name>]
crewel team closeout [--team <name>]
crewel team stop [--team <name>] [--now]
crewel team start [--team <name>]
crewel team check-stalls --older-than-ms <ms>
crewel tickets validate [--team <name>]
crewel ticket assign <id> --to <teammate>
crewel ticket clarify <id> --answer "..."
crewel ticket unfreeze <id>
crewel teammate tick <id>
crewel teammate interrupt <id>
crewel teammate pause <id> --reason "..."
crewel teammate resume <id>
```

Run `crewel --help` or `crewel <command> --help` for details. Unknown commands and missing flags report `error: ... — try "crewel ..."` with the exact fix.

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — original hand-off spec (written under the placeholder name "Motley")
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — grill-session decision log (every resolved design question)
- [`docs/PRD.md`](docs/PRD.md) — product requirements for v1

## License

MIT — see [LICENSE](LICENSE).
