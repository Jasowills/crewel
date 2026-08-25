# 05: Worktree provisioning & branch topology

**What to build:** Team creation provisions one isolated git worktree per teammate, with the branch topology from the decision log: ticket branches named `crewel/{team}/{ticket-id}` cut from the integration branch tip, integration branch `crewel/{team}` created if absent, and `main` never touched during a run. Establishes the sacred rule early: nothing ever resets or deletes a teammate worktree to "clean up".

**Blocked by:** 02 Team creation & on-disk state.

**Status:** done

- [x] Creating a team with N teammates yields N isolated worktrees, each checked out on its own branch
- [x] Integration branch `crewel/{team}` exists; `main` is untouched by team operations
- [x] New ticket branches are cut from the current integration tip
- [x] A failed or killed turn leaves the worktree byte-for-byte preserved (verified in a fixture)
- [x] Cleanup of merged branches happens only at archive time, never mid-run
