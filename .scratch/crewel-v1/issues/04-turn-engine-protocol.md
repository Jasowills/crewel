# 04: Turn engine & TurnReport protocol (mock adapter)

**What to build:** The heart of Crewel, fully provable with zero real agents: assigning a ticket assembles a context bundle from disk, the mock adapter executes a turn inside the teammate's worktree, the TurnReport is schema-validated before anything trusts it, statuses transition (including the `needs-clarification` sub-state pending a lead answer), mailbox messages deliver exactly at turn boundaries, and heartbeats appear during turns for later watchdog use. This ticket owns the subtle logic the spec called riskiest — completion signaling and state transitions — and must be built test-first.

**Blocked by:** 03 Direct-mode tickets & board view.

**Status:** ready-for-agent

- [ ] Assignment produces a context bundle containing the ticket, unread mailbox messages, prior progress notes, worktree path, and role instructions
- [ ] Every turn ends with a TurnReport validated against the schema; an invalid/missing report is treated as failed-retryable, never silently "done"
- [ ] Report statuses drive board transitions: done / blocked / in-progress
- [ ] `needs-clarification` holds the ticket in an assigned-pending-clarification sub-state, routes the question to the lead, and a lead reply releases it back to work
- [ ] Messages arriving mid-turn queue and deliver at the next turn boundary; none lost or duplicated
- [ ] Heartbeat file touched during turns and cleared/settled afterward
