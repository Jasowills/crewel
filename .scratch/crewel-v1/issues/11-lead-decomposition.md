# 11: Lead decomposition mode

**What to build:** The headline experience on a real agent: `crewel team run --request "..."` has the dedicated non-coding lead decompose the request into a well-formed board — independently workable tickets with acceptance criteria and sane dependency edges — and assign them to available teammates. Direct mode still bypasses decomposition entirely. Also proves the senior-bar loop from the lead side: teammate pushback gets answered, not ignored.

**Blocked by:** 09 OpenCode adapter.

**Status:** ready-for-agent

- [ ] A sample request yields tickets that pass validation and are assignable
- [ ] Dependency edges form an acyclic graph with no orphan blockers
- [ ] The lead holds no code-writing permissions (verified behaviorally)
- [ ] Clarification loop proven end-to-end: teammate emits needs-clarification, lead answers, work resumes
- [ ] Works with any nominated lead type (OpenCode first; other types ride the adapter contract)
