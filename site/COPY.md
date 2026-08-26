# Crewel — Landing Copy (beats build)

Prerequisites (reader walks in with): knows coding agents, lives in terminal + npm, knows what a ticket is.
Grounded so far: cross-agent, board, lead, tickets, worktrees, live push, no daemon, gated merge, adapters.

---

Every multi-agent tool makes you pick a vendor. One crew of Claude. One crew of OpenCode.

Crewel is the board where they work together. One lead, any mix of OpenCode, Claude Code and Codex, on your repo.

`npm install -g crewel`

---

You prompt the lead. It splits the request into tickets you can actually check: scope, acceptance, deps. Each teammate takes one ticket, in its own worktree. Status pushes live. You watch one board: open → assigned → in-progress → in-review → done.

---

No daemon. No dashboard to babysit. Heartbeats watch each turn. If one stalls, it's flagged. A teammate hitting a rate limit pauses, it doesn't sink the team. Nothing fails silent.

---

Work happens on `crewel/{team}/{ticket}` branches cut from `crewel/{team}/integration`. The lead merges only after review. `main` moves when you merge the close-out PR. Not before.

---

OpenCode first, then Claude Code, then Codex. The third adapter is the proof. The pattern holds. Adding another agent is one file. Mock runs the whole loop with no LLM, for CI.

---

One board. Mixed agents. Tickets you can trust.

`npm install -g crewel` — your repo, your crew.
