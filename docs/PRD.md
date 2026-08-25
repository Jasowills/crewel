# Crewel — PRD (v1)

**Status:** Draft for review
**Author:** Jason Amadi, drafted from the original hand-off spec ([`SPEC.md`](SPEC.md)) and two grill rounds ([`DECISIONS.md`](DECISIONS.md))
**Name origin:** crewel embroidery — many differently-colored threads stitched into one fabric; many different coding agents stitched into one team.

---

## 1. Problem & Vision

Every existing multi-agent coding tool is single-vendor: Claude Code's Agent Teams runs only Claude Code; Gas Town and Multiclaude run only one agent type each. Nobody can put an OpenCode teammate, a Claude Code teammate, and a Codex teammate on the **same ticket board**, coordinating through **the same protocol**, with a lead orchestrating the work.

Crewel is that missing tool: a standalone, open-source CLI that assembles a genuinely mixed crew of coding agents, has a dedicated non-coding lead decompose incoming requests into properly-scoped tickets, lets teammates execute those tickets independently in isolated git worktrees, and pushes every relevant state change to teammates and to the human in real time — no polling.

Three commitments carried over from the spec:

1. **Cross-agent teams are the product.** Same-protocol coordination across heterogeneous agents.
2. **Tickets, not a flat task list.** Real status, assignee, dependencies, acceptance criteria — `prd-to-issues` discipline, enforced by protocol.
3. **Push, not poll.** File-watcher-based live notification for every state change that matters.

Plus one that emerged in grilling:

4. **Senior/principal bar, enforced by contract.** "Push back on unclear tickets" isn't a prompt aspiration — it's a first-class protocol state (`needs-clarification`) every teammate can emit and the lead must answer.

## 2. Non-goals for v1

| Deferred | Why |
|---|---|
| Persistent/interactive teammate sessions | Turn-based execution (§4.2) covers v1; sessions become a per-adapter optimization later |
| Gemini CLI adapter | Consumer tier stopped serving 2026-06-18; product sunsetting toward Antigravity |
| Declarative dollar/token budgets | Reactive rate-limit detection suffices for v1 (Q17) |
| Dashboard, desktop push by default | `jason.log` + `team watch` tail is the v1 surface (Q10) |
| Multiple active teams per repo | One active team per repo enforced (Q20) |
| Assignment intelligence beyond lead judgment | Round-robin-or-judgment is enough until core mechanics prove out |
| Auto-merge to `main` | Jason always gates the close-out PR (Q8/Q15) |

## 3. Glossary

- **Team** — one named crew: 1 lead + N teammates, created against one target repo.
- **Lead** — a dedicated, non-coding agent instance. Decomposes requests into tickets, assigns them, answers clarifications, reviews `in-review` tickets. Never writes code.
- **Teammate** — a working agent instance of some adapter-backed type. Executes exactly one ticket at a time in its own worktree.
- **Adapter** — translator between Crewel's universal contract and one agent CLI's invocation shape. Core never talks to agents directly.
- **Turn** — one fresh headless invocation of a teammate, seeded with a context bundle assembled from disk. There is no long-lived process per teammate in v1.
- **Context bundle** — everything a turn needs, rendered per-agent by its adapter: current ticket, dependency summaries, unread mailbox messages, prior progress notes, worktree path, role instructions.
- **TurnReport** — schema-validated JSON artifact every teammate must write at the end of every turn: `status`, `summary`, `changedFiles`, `testEvidence`. The completion signal.
- **Heartbeat** — file touched periodically during a turn; feeds the stall watchdog.
- **Mailbox** — per-participant message directory, watched for live delivery at turn boundaries.
- **Integration branch** — `crewel/{team}`; the only branch the lead merges reviewed work into. Close-out is one PR integration → `main`, gated by Jason.
- **checkCommand gate** — optional per-project command run by Crewel in the ticket's worktree before accepting `done`.

## 4. Architecture

### 4.1 Shape

```
┌──────────────────────────────────────────────────────┐
│                    CREWEL CORE                        │
│  ticket board · mailbox routing · lifecycle           │
│  notifications · watchdogs · merge checkpoints        │
└───────────┬──────────────┬──────────────┬────────────┘
            │              │              │
     ┌──────▼─────┐ ┌──────▼─────┐ ┌─────▼──────┐
     │  Adapter:  │ │  Adapter:  │ │  Adapter:  │
     │  OpenCode  │ │Claude Code │ │   Codex    │
     └──────┬─────┘ └──────┬─────┘ └─────┬──────┘
            │              │              │
      headless turn   headless turn   headless turn
      in worktree A   in worktree B   in worktree C

        .crewel/teams/{name}/   ← single source of truth,
                                  human-readable files on disk
```

### 4.2 Turn-based execution model (Q4)

Crewel does not keep teammate processes alive. When a participant's mailbox has undelivered messages (or a turn is otherwise due — assignment, dependency resolution, clarification answer), Core assembles the context bundle from disk, and the adapter executes one fresh headless invocation inside that participant's assigned worktree. All durable state lives in `.crewel/`; nothing important lives only in an agent's context window. Consequences:

- Any agent that supports a `-p "prompt"` style invocation works identically.
- Crashes lose nothing; the next turn re-reads state from disk.
- Heterogeneous context handling (spec §4.1) collapses into one bundle format + per-agent rendering.
- Mid-turn messages queue until the turn boundary (Q14); interrupt = kill the in-flight process, mark the turn aborted, preserve the worktree.

### 4.3 Coordination layer layout (gitignored, Q11)

```
.crewel/
  teams/{team-name}/
    config.json            composition: lead type, teammate types, settings, checkCommand
    tickets/
      {ticket-id}.md       hand-authored view (YAML frontmatter) when applicable
      {ticket-id}.json     normalized internal form: id/title/scope/status/assignee/
                           dependencies/acceptanceCriteria
    messages/{participant-id}/
                           mailbox; oldest-first JSON lines, consumed+archived per turn
    reports/{ticket-id}/
                           TurnReports per attempt
    heartbeats/{participant-id}
    notifications/
                           jason.log — append-only human-facing stream
```

Debuggability is a requirement: any user can `cat` their way to full understanding of team state. No opaque binary state anywhere.

### 4.4 Git topology (Q15)

- Ticket branches: `crewel/{team}/{ticket-id}`, cut from the integration tip.
- Integration branch: `crewel/{team}`. Lead merges into it after review passes only.
- `main` untouched during a run. Close-out = one PR integration → `main`, gated by Jason.
- On dependency-resolved notification, assignee rebases onto the new integration tip during its next turn; conflicts it can't cleanly resolve → ticket `blocked`, escalate.
- Failed/interrupted/killed turns never delete or reset worktrees — inspection always wins over tidiness (Q9/Q14).

## 5. Functional requirements

### 5.1 Team creation & intake

- **FR-1** `crewel team create {name} --lead {type} --teammates {type}:{count},...` — instance count and agent type per instance are first-class creation-time config (Q19: any adapter may be lead). Creation validates that each nominated CLI exists and is authenticated before anything spawns.
- **FR-2** Two intake modes:
  - *Default:* `crewel team run {name} --request "..."` — the lead decomposes the request into tickets (independently workable, clearly scoped, explicit acceptance criteria — prd-to-issues discipline) and assigns them.
  - *Direct:* hand-authored Markdown tickets with YAML frontmatter, validated by `crewel tickets validate`, then run without lead decomposition (Q18).
- **FR-3** One active team per target repo; violating attempts get a clear error (Q20). Requires the target to be a git repo; worktree-per-teammate is mandatory (Q11).

### 5.2 Lead behavior

- **FR-4** Decompose, assign (availability-based judgment), answer `needs-clarification` mail, review `in-review` tickets, order merges to integration. No code-writing permissions on the lead (Q6).
- **FR-5** Review ownership default: lead; per-team override allowed; Jason gates `main` (Q8).

### 5.3 Teammate behavior & protocol

- **FR-6** Every teammate operates at a senior/principal bar via adapter-native persona injection (OpenCode agent definitions, Claude Code `--append-system-prompt`, Codex `developer_instructions`). Uniform bar across types.
- **FR-7** Every turn ends with a schema-validated TurnReport. Statuses include at minimum: `done`, `blocked`, `needs-clarification`, `in-progress`. `needs-clarification` routes to the lead and holds the ticket in an assigned-pending-clarification sub-state (Q5).
- **FR-8** Heartbeat file touched during turns; stall watchdog flags a teammate whose heartbeat exceeds its configured threshold → treated per failure policy.
- **FR-9** Peer-to-peer messaging is allowed; all messages deliver at turn boundaries (Q14).
- **FR-10** Adapter-native structured-output enforcement where available (OpenCode `json_schema`, Claude Code `--json-schema`, Codex `--output-schema`); prompt-compliance + validation fallback elsewhere (Q5 research finding).

### 5.4 Notifications

- **FR-11** All state changes push immediately via file-watchers: teammate↔teammate, lead→teammate, teammate/lead→Jason. No polling loops (spec §3.3, Q10).
- **FR-12** Human surface: `notifications/jason.log` + `crewel team watch {name}` live tail; desktop ping behind a flag (Q10).

### 5.5 Lifecycle operations

- **FR-13** `crewel team status {name}` / `crewel team tickets {name}` — ticket board across `open / assigned / in-progress / needs-clarification / in-review / blocked / done`.
- **FR-14** Interrupt: SIGTERM in-flight turn → turn marked `aborted`, ticket returns to `assigned`, worktree preserved. `crewel team stop` drains in-flight turns then shuts down; `--now` kills immediately (Q14).
- **FR-15** Failure recovery (hybrid, Q9): auto-reassign only if an idle teammate exists AND the failed worktree shows no uncommitted mess; >2 failures on one ticket → freeze + escalate to Jason; failed worktrees never deleted.
- **FR-16** Rate limits, reactive only (Q17): adapter-specific detection (typed `api_retry` events from Claude Code, provider 429 patterns elsewhere) → auto-pause teammate (stops claiming tickets), notify Jason; manual `crewel teammate pause/resume`.
- **FR-17** Done gate (Q16): if `checkCommand` is configured, Crewel runs it in the ticket's worktree; failure bounces the ticket back to `in-progress`. Unconfigured = no gate.
- **FR-18** Archive (Q11): `crewel team archive` snapshots ticket history into the repo at close-out.

### 5.6 Adapters

- **FR-19** Adapter contract (turn-centric, replacing the spec §3.4 sketch):
  - `capabilities()` — structured-output enforcement support, persona-injection lever, sandbox/approval configuration
  - `runTurn(bundle)` — execute one headless turn in the assigned worktree; enforce TurnReport schema natively where possible
  - `classifyOutcome(raw)` — map agent-specific signals onto `{completed | failed-retryable | failed-terminal | rate-limited | needs-input}`. Key off structured events + report-file presence, never exit codes alone (none of the three CLIs publish reliable exit-code tables)
  - `renderBundle(bundle)` — format context bundle per-agent
- **FR-20** v1 adapters, in build order: mock (core testing) → **OpenCode** (Jason's daily driver; highest reliability bar, built and tested first) → **Claude Code** → **Codex** (third-type proof).

## 6. Non-functional requirements

- **NFR-1** Human-readable, cat-able coordination state; no opaque formats (spec §3.5).
- **NFR-2** No daemon/server process; plain CLI operating over the cwd repo.
- **NFR-3** TypeScript, Node ≥20, ESM, vitest; single npm package (Q3).
- **NFR-4** Graceful degradation everywhere: pause, never silently fail the team (spec §4.4).
- **NFR-5** Worktrees are sacred: no command deletes or resets teammate work except archive-time cleanup of merged branches.
- **NFR-6** MIT license (Q2).

## 7. Milestones

| # | Milestone | Acceptance criteria |
|---|---|---|
| M1 | Core + mock adapter | Full ticket/mailbox/report/watchdog loop provable end-to-end in tests with zero real agents; TDD throughout — this milestone owns the subtle logic (state machine, routing, completion classification) |
| M2 | OpenCode adapter | Real OpenCode teammate completes a scoped ticket in a scratch repo; TurnReport enforced via SDK `json_schema`; persona injection via agent definition; held to highest bar |
| M3 | Claude Code adapter | Same bar via `claude -p --output-format json --json-schema`; `api_retry` events mapped to rate-limit handling |
| M4 | Codex adapter | Proves pattern generalizes to a third, structurally different agent (`codex exec --output-schema`, AGENTS.md injection) |
| M5 | Worktree isolation + checkpoints | Parallel teammates on one repo without conflicts; dependency-resolve rebases; conflict escalation path works |
| M6 | CLI polish + archive + docs | Full command surface, `tickets validate`, `team watch`, `team archive`, README worth starring |

## 8. v1 success criterion

On a real repository:

```bash
crewel team create login-flow --lead claude-code --teammates opencode:2,codex:1
crewel team run login-flow --request "Implement the login flow per docs/spec.md"
```

…produces a lead-decomposed ticket board, mixed-agent teammates executing in isolated worktrees with live push notifications observable via `crewel team watch`, review-gated merges to the integration branch, and a clean close-out PR — with zero silent failures and zero polling, end to end.

---

*Everything above traces to a resolved decision; see [`DECISIONS.md`](DECISIONS.md). Nothing in this PRD is aspirational — the senior-engineer bar is FR-6/FR-7, push-not-poll is FR-11/FR-12, and "never guess" is a protocol state.*
