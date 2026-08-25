# 13: Codex adapter

**What to build:** The third, structurally most different agent — deliberately sequenced after both other adapters so an architecture sanity pass can confirm the interface generalized before this lands. A Codex teammate completes a scoped ticket end-to-end via non-interactive exec: read-only-by-default sandbox correctly configured for workspace writes, persona injected through the layered AGENTS.md mechanism, TurnReport enforced via output-schema, JSONL event streams classified per the outcome contract.

**Blocked by:** 09 OpenCode adapter, 10 Claude Code adapter.

**Status:** done

- [x] Completes a scoped ticket end-to-end in a scratch repo
- [x] Sandbox/approval config allows workspace writes without granting full system access
- [x] Output-schema enforces the TurnReport; `turn.failed`/error events mapped to contract outcomes
- [x] Core needed zero adapter-specific special cases to accommodate Codex (the generalization proof)
