# 12: Review → merge → close-out

**What to build:** The full lifecycle finale: `in-review` tickets get a lead verdict; when configured, the project's check command runs as a law-enforcing done-gate in the ticket's worktree (failure bounces the ticket back to in-progress); passed tickets merge to integration; and `team archive` snapshots the ticket history into the repo while opening the single close-out PR integration→main that only Jason can land.

**Blocked by:** 08 Checkpoint merges & dependency rebases, 11 Lead decomposition mode.

**Status:** done

- [x] No merge without a recorded review pass
- [x] Configured checkCommand runs in the ticket worktree; failing it bounces the ticket to in-progress; unconfigured means no gate
- [x] Merged tickets' branches cleaned up only after merge
- [x] Archive writes a human-readable history snapshot into the target repo
- [x] Close-out PR opened integration→main, gated on Jason
