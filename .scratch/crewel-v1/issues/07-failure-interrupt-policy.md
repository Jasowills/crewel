# 07: Failure, interrupt & rate-limit policy

**What to build:** The full graceful-degradation surface from the decision log, exercised through mock adapters that simulate every failure mode: SIGTERM interrupt of an in-flight turn (aborted, ticket back to assigned, worktree untouched), graceful `team stop` draining vs. `--now`, stall watchdog over stale heartbeats, reactive rate-limit detection pausing a teammate with Jason notified, the hybrid recovery rule (auto-reassign only when an idle teammate exists and the failed worktree is clean), and freeze-after-two-failures with escalation. Manual pause/resume included.

**Blocked by:** 04 Turn engine & TurnReport protocol (mock adapter), 05 Worktree provisioning & branch topology, 06 Live notifications.

**Status:** done

- [x] Interrupting a turn marks it aborted, returns the ticket to assigned, and leaves the worktree byte-for-byte intact
- [x] `team stop` lets in-flight turns finish then shuts down; `--now` kills immediately
- [x] A heartbeat exceeding its threshold flags the teammate stalled and applies the failure policy
- [x] Rate-limit-classified failures auto-pause the teammate (stops claiming tickets), notify Jason, and resume cleanly on command
- [x] Auto-reassign fires only for idle-teammate + clean-worktree cases; a messy worktree escalates to Jason instead
- [x] A third failure on the same ticket freezes it and escalates; frozen tickets are immune to reassignment until manually released
