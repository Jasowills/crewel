# 08: Checkpoint merges & dependency rebases

**What to build:** The integration-branch workflow made real: a ticket that passes review becomes mergeable into `crewel/{team}` (lead-ordered, review-pass required), and when a dependency resolves, the assignee's next turn rebases onto the new integration tip. A conflict the agent can't cleanly resolve blocks the ticket and escalates instead of force-pushing or hand-merging. All paths proven against scriptable git fixtures.

**Blocked by:** 04 Turn engine & TurnReport protocol (mock adapter), 05 Worktree provisioning & branch topology.

**Status:** ready-for-agent

- [ ] A ticket merges into the integration branch only after its review pass is recorded
- [ ] Dependency-resolved notification causes the dependent's next turn to include a rebase onto the new integration tip; clean rebase proven in a fixture
- [ ] Conflicting fixture → ticket blocked + escalation message; no force-push anywhere in the codebase
- [ ] Integration branch history stays linear and readable
