# 02: Team creation & on-disk state

**What to build:** An operator runs `crewel team create {name} --lead {type} --teammates {type}:{count},...` and gets a real, inspectable team: composition written as human-readable JSON under the coordination directory, with every guard from the decision log enforced up front so bad teams can never half-exist. A mock adapter is registered so all of this works on machines without any real agent CLIs installed.

**Blocked by:** 01 Toolchain bootstrap.

**Status:** done

- [x] Create writes `config.json` (lead type, teammate roster, settings) under `.crewel/teams/{name}/`
- [x] Refuses to run outside a git repo with a clear error (worktree-per-teammate is mandatory in v1)
- [x] Refuses a second active team in the same repo with a clear error (one-active-per-repo rule)
- [x] Unknown adapter type rejected, listing known types
- [x] Mock adapter registered and selectable, so no real CLIs are needed for core testing
- [x] `crewel team status` shows composition and a lifecycle summary of the board
