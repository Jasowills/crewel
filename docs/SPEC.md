# Crewel — Original Hand-off Spec

> **Historical document.** This spec was written by Jason Amadi under the
> placeholder name **"Motley"** before the project was named. The project is
> now **Crewel** (decision log §Q13). Where this document conflicts with
> [`DECISIONS.md`](DECISIONS.md) or [`PRD.md`](PRD.md), those win. Notably,
> the Gemini CLI option in §6.1 was eliminated when Google's consumer-tier
> sunset took effect on 2026-06-18, and the build process in §7 was revised
> during grilling (see DECISIONS.md §Q12).

---

# Motley — Open-Source Cross-Agent Team Orchestrator — Spec

**Author:** Jason Amadi
**Purpose:** Hand-off spec for OpenCode. A standalone, open-source tool that orchestrates a "team" of coding agents, potentially different agent types at once (OpenCode, Claude Code, Codex/Gemini CLI), working together on a shared task list with peer-to-peer coordination — the same pattern as Claude Code's native Agent Teams feature and open-source alternatives like Gas Town and Multiclaude, but agent-agnostic instead of locked to one vendor.

**Naming note:** "Motley" is a placeholder (as in "motley crew" — a team of different types working together). Pick a real name before publishing; check for name collisions on GitHub/npm first.

---

## 1. Vision & Positioning

Claude Code's Agent Teams, and open-source tools like Gas Town and Multiclaude, all share the same core pattern: a lead agent breaks work into tasks, teammates claim and execute tasks independently in their own context windows, and they coordinate through a shared task list and message-passing rather than everything routing through one central bottleneck.

**What doesn't exist yet, and what this project is:** none of the current tools let you mix genuinely different agent types in the same team. You can run five Claude Code instances together, or five OpenCode instances together, but not one OpenCode teammate working alongside one Claude Code teammate and one Codex teammate on the same task list, communicating through the same coordination layer.

Motley closes that gap, and goes further than what exists today in three specific ways:

1. **Cross-agent teams** (the core gap above) — a genuinely mixed team, not same-agent-only.
2. **Issue/ticket-based workflow, not just a flat task list** — teammates work the way a real senior engineering team does: work is broken into properly-scoped tickets/issues (mirroring the discipline of Matt Pocock's `prd-to-issues` skill — a PRD gets decomposed into independently-workable issues with clear scope, not a vague shared todo list), tracked with status, assigned, and closed out — not just claimed off an undifferentiated list.
3. **Live notification, not silent background work** — every teammate is notified the moment something relevant happens: a ticket gets assigned to them, a peer teammate posts an update, a blocking dependency resolves, the lead reassigns work. Existing tools require polling a shared task list; Motley pushes state changes to the teammates that need to know, and to Jason.

**Quality bar / persona framing:** every teammate operates as a **senior/principal-level engineer**, not a generic junior assistant. This isn't cosmetic — it means each adapter should configure its underlying agent (via system prompt, mode selection, or whatever lever that agent exposes) to work with senior-engineer judgment: push back on unclear tickets rather than guessing, flag scope creep, write the kind of tests and documentation a principal engineer would consider table stakes, not skip. This applies uniformly across every agent type in the team, an OpenCode teammate and a Claude Code teammate should feel like peers with the same bar, not one "smarter" than the other by default.

**Why build this as open source, standalone (not inside Korvid):** this is genuinely useful to anyone who uses more than one coding agent, not just Jason. It's also a stronger open-source portfolio piece than a PR into someone else's repo, since it's an original project with real technical depth (multi-agent coordination, protocol design, cross-tool adapters). Korvid can later adopt Motley as its own delegate layer once it exists, but Motley isn't built as a Korvid-only feature.

---

## 2. Core Architecture

```
┌───────────────────────────────────────────────────────────┐
│                        MOTLEY CORE                          │
│   (the orchestrator — spawns agents, owns the shared task   │
│    list, routes messages, manages lifecycle)                 │
└─────────────────────────┬─────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
│  Adapter:      │  │  Adapter:      │  │  Adapter:      │
│  OpenCode      │  │  Claude Code   │  │  Codex/Gemini  │
│  (CLI wrapper) │  │  (CLI wrapper) │  │  (CLI wrapper) │
└───────┬──────┘  └───────┬──────┘  └───────┬──────┘
        │                 │                 │
┌───────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
│  OpenCode      │  │  Claude Code   │  │  Codex/Gemini  │
│  process       │  │  process       │  │  process       │
│  (teammate)    │  │  (teammate)    │  │  (teammate)    │
└──────────────┘  └──────────────┘  └──────────────┘

              ┌─────────────────────────┐
              │  Shared coordination     │
              │  layer (file-based, v1)  │
              │  — task list             │
              │  — mailbox/messages      │
              │  — teammate lifecycle    │
              │    state                 │
              └─────────────────────────┘
```

### Why adapters, not a unified API
Each coding agent has its own CLI/API shape — different invocation syntax, different session/context handling, different ways of reporting progress or completion. Motley Core never talks to an agent directly; it always goes through that agent's adapter. This is the key design decision that makes cross-agent teams possible: the coordination protocol (task list, messages, lifecycle) is universal, and each adapter's only job is translating that universal contract into whatever the underlying agent actually understands.

### Why file-based coordination for v1
Matches the same mechanism Claude Code's own Agent Teams uses internally (a directory structure with team configs, task state, and per-session message files) — proven to work, simple to implement, simple to debug (you can literally `cat` the state), and requires no additional server process running. This can be swapped for a lightweight local message bus later if file-based coordination proves too slow or fragile at scale, but v1 should not over-engineer this.

---

## 3. Component Breakdown

### 3.1 Motley Core (the orchestrator)
- Spawns and manages the lifecycle of teammate processes (start, monitor, graceful shutdown)
- Owns the shared **ticket system** (see §3.2) and the notification system (see §3.3)
- Runs as a **lead-required model by default**: one teammate (or a dedicated non-coding lead role — see Open Questions) acts as team lead, breaking incoming work into properly-scoped tickets and assigning them to available teammates. This is the primary mode, matching the "issue/ticket, senior-engineering-team" workflow. A simpler "Jason defines tickets directly" mode should still be supported for smaller jobs, but the lead-orchestrated mode is the default, headline experience.
- **Instance configuration**: at team-creation time, Jason specifies how many teammate instances to spin up and which agent type each one runs (e.g., "3 teammates: 2 OpenCode, 1 Claude Code, plus 1 lead"). This is a first-class, explicit setup step, not an afterthought.

### 3.2 Ticket System (not just a flat task list)
This is a core differentiator from existing tools (§1). Work is tracked as proper tickets, not loose todo entries:

- **Ticket fields**: id, title, description/scope, status (`open` → `assigned` → `in-progress` → `in-review` → `done`/`blocked`), assigned teammate, dependencies on other tickets, acceptance criteria.
- **Ticket creation**: the team lead decomposes an incoming request (a feature, a bug, a spec) into tickets — mirroring the discipline of Matt Pocock's `prd-to-issues` skill: each ticket should be independently workable, clearly scoped, with acceptance criteria a teammate (or Jason) can check against, not vague.
- **Assignment**: the lead assigns tickets to teammates based on availability and (eventually, v2+) suitability — for v1, simple round-robin or lead's judgment call is sufficient; don't over-engineer assignment intelligence before the core mechanics work.
- **Senior-engineer behavior expectation**: a teammate receiving a poorly-scoped ticket should push back to the lead (via the messaging system) rather than silently guessing — this is part of the "senior/principal engineer" quality bar from §1, and should be an explicit, testable behavior, not just an aspiration.

### 3.3 Notification System
Every relevant state change triggers a notification, not silent polling:

- **Teammate → teammate**: when a peer posts a message, completes a dependency, or requests review, the relevant teammate(s) are notified immediately (not left to poll the shared state periodically).
- **Lead → teammate**: ticket assignment, reassignment, or priority change triggers an immediate notification to the affected teammate.
- **Any teammate → Jason**: ticket completion, a teammate getting blocked/stuck, or the lead flagging something needing human judgment should surface to Jason in real time (exact delivery mechanism — terminal notification, desktop notification, webhook — is a v1 implementation detail, see Open Questions).
- **Mechanism (v1)**: given the file-based coordination layer (§3.5), notifications can be implemented as a lightweight file-watcher (each teammate process watches its own mailbox directory for changes) rather than requiring a separate message broker — keeps v1 simple while still delivering real push-style notification instead of polling on a timer.

### 3.4 Agent Adapters
Each adapter implements a common interface, something like:

```
interface AgentAdapter {
  spawn(taskContext): ProcessHandle
  checkStatus(handle): 'idle' | 'working' | 'blocked' | 'done' | 'failed'
  sendMessage(handle, message): void
  getOutput(handle): TaskResult
  terminate(handle): void
}
```

- **OpenCode adapter** — wraps OpenCode CLI invocation, given OpenCode is Jason's primary daily driver, this adapter should be built and tested first, and held to the highest reliability bar
- **Claude Code adapter** — wraps Claude Code CLI, ideally reusing/mirroring the same file-based coordination structure Claude Code's own Agent Teams already uses internally, since that reduces translation friction
- **Codex or Gemini CLI adapter** (pick one for v1 per the scope decision — Jason to confirm which) — proves the pattern generalizes to a third, meaningfully different agent

### 3.5 Shared Coordination Layer (file-based, v1)
- A directory structure per active team, e.g.:
```
.motley/
  teams/{team-name}/
    config.json          — team composition: instance count, agent type per teammate, who's lead
    tickets/
      {ticket-id}.json    — ticket definition, status, assigned teammate, dependencies, acceptance criteria
    messages/
      {teammate-id}/       — mailbox per teammate (watched for live notification)
    notifications/
      jason.log            — human-facing notification stream (completions, blockers, review requests)
```
- This should be human-readable and debuggable by design — Jason (or any user) should be able to open these files directly and understand exactly what's happening, no opaque binary state.

### 3.6 CLI / Entry Point
- Simple command-line interface to define a team (instance count + agent type per instance + who's lead), and kick off work as tickets
- Example (illustrative, not prescriptive — OpenCode should design the actual CLI ergonomics):
```bash
motley team create my-feature --lead claude-code --teammates opencode:2,claude-code:1
motley team run my-feature --request "Implement the login flow per spec.md"
  # lead breaks this into tickets automatically
motley team status my-feature
motley team tickets my-feature
  # shows ticket board: open / assigned / in-progress / in-review / done / blocked
```

---

## 4. Key Technical Challenges (name these honestly, don't gloss over them)

1. **Heterogeneous context handling** — each agent manages its own context window differently. Motley needs to pass enough shared context (the task, relevant files, prior teammate messages) to each agent in whatever format that agent expects, without assuming they all handle context the same way.
2. **Divergent completion signaling** — knowing when a teammate is actually "done" vs. stuck vs. silently failed differs per agent (exit codes, output parsing, no clean signal at all in some cases). Each adapter needs its own honest detection logic; Motley Core should never assume a generic "done" state applies uniformly.
3. **Conflicting edits** — if multiple teammates (potentially different agent types) work on the same codebase simultaneously, file conflicts are a real risk. v1 should lean on git worktrees per teammate (the same pattern already used in advanced Claude Code multi-agent setups) to keep teammates working in isolated working directories, merging only at defined checkpoints.
4. **Cost/rate-limit awareness** — different agents have different usage limits and cost models (this directly mirrors why Jason wants Veya's resume tool to support multiple providers). Motley should be aware of which agent is under which constraints and degrade gracefully (e.g., pause a teammate hitting a rate limit rather than silently failing the whole team).

---

## 5. Explicit Requirements Checklist

- [ ] Standalone, open-source repo — not a Korvid-only feature
- [ ] Motley Core: spawns/manages teammate processes, owns the ticket system and notification system
- [ ] Jason can specify instance count and agent type per instance at team-creation time
- [ ] One team lead by default, decomposes incoming requests into properly-scoped tickets (mirroring `prd-to-issues`-style discipline) and assigns them to teammates
- [ ] Tickets have real fields: status, assignee, dependencies, acceptance criteria — not a flat todo list
- [ ] Teammates configured to behave as senior/principal engineers: push back on unclear tickets, flag scope creep, don't silently guess
- [ ] Live notification system: teammate-to-teammate, lead-to-teammate, and teammate-to-Jason state changes push immediately (file-watcher based in v1), not silent polling
- [ ] Agent adapter interface defined and implemented for OpenCode, Claude Code, and one of Codex/Gemini CLI (v1)
- [ ] File-based coordination layer, human-readable, debuggable by inspecting files directly
- [ ] Git worktrees (or equivalent isolation) per teammate to avoid edit conflicts
- [ ] Graceful handling of divergent completion/failure signaling per agent type
- [ ] Rate-limit/cost-awareness per agent, with graceful degradation (pause, not silent failure)
- [ ] CLI entry point: create a team (with instance/agent config), run a request, view ticket board, check status
- [ ] Both "lead decomposes into tickets" (default) and "Jason defines tickets directly" modes supported

---

## 6. Open Questions

1. **Which third agent for v1**: Codex or Gemini CLI? (Jason to confirm — affects adapter design specifics.)
2. **Lead role — dedicated or a working teammate?**: should the team lead be a separate, non-coding orchestrator role (only decomposing/assigning tickets, never writing code itself), or one of the working teammates who does double duty as lead + contributor? A dedicated lead is cleaner conceptually but "wastes" an instance on pure coordination; a dual-role lead is more efficient but risks the lead getting too deep into its own ticket to orchestrate well.
3. **Failure recovery**: if a teammate fails or stalls entirely, does the lead auto-reassign its ticket to another available teammate, or surface the failure and wait for Jason to decide?
4. **Notification delivery to Jason**: terminal output, desktop notification, a simple log file Jason checks, or something richer (e.g., a lightweight local dashboard)? File-based log is the simplest v1 default (§3.5) but worth confirming this is actually how Jason wants to be notified in practice.
5. **License**: standard permissive open-source license (MIT/Apache 2.0) — any preference, or defer to whatever's simplest for adoption?
6. **Real name**: "Motley" is a placeholder — worth deciding on the actual project name before any code/README references it, since renaming later is disruptive for an open-source project people might star/fork.

---

## 7. Recommended Build Process (Matt Pocock's OpenCode skills)

Given this is a technically ambitious, protocol-design-heavy project — exactly the kind of spec that benefits from being interrogated before any code gets written:

1. **`/grill-me`** — run this against the entire spec first. This should specifically press on: the adapter interface design (§3.4 — is the proposed interface actually sufficient for three genuinely different agents, or does it need more/fewer methods?), the completion-signaling problem (§4.2 — this is the riskiest unsolved part of the spec), the lead role question (§6.2 — dedicated vs. dual-role lead has real architectural consequences), and all remaining open questions in §6.
2. **`/write-a-prd`** — turn the grilled spec into a proper PRD.
3. **`/prd-to-plan`** — phase the build: (1) Motley Core + file-based coordination layer alone, testable with a trivial mock adapter, (2) OpenCode adapter — the first real integration, held to the highest bar since it's Jason's primary tool, (3) Claude Code adapter, (4) third adapter (Codex/Gemini), (5) git worktree isolation + conflict handling, (6) CLI polish.
4. **`/tdd`** — especially critical for the adapter interface and completion-signaling logic (§4.2) — these are exactly the kind of subtle, easy-to-get-wrong logic that benefits from tests written before implementation.
5. **`/improve-codebase-architecture`** — run once the first two adapters exist, to sanity-check the adapter interface is genuinely generalizing well before building the third, rather than discovering architectural debt after all three are done.
