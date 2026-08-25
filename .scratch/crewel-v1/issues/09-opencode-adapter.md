# 09: OpenCode adapter

**What to build:** The first real adapter — Jason's daily driver, held to the highest reliability bar. A real OpenCode teammate completes a scoped ticket end-to-end in a scratch repo: bundle rendered per-agent, senior-bar persona injected via an OpenCode agent definition, TurnReport natively enforced through the SDK's JSON-schema structured output, and outcomes classified from structured events rather than exit codes (which OpenCode does not document).

**Blocked by:** 04 Turn engine & TurnReport protocol (mock adapter), 05 Worktree provisioning & branch topology.

**Status:** done

- [x] Headless invocation runs in the correct worktree with permissions configured for unsupervised operation
- [x] TurnReport enforced via native JSON-schema structured output; schema failure surfaces as failed-retryable
- [x] Senior-bar persona active and demonstrable: an intentionally unclear ticket produces `needs-clarification` pushback rather than a guess
- [x] Error signatures (auth, provider 429/rate-limit) mapped onto the outcome contract
- [x] Reliability bar: repeated runs across fresh scratch repos complete without flake
