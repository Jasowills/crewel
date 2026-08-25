# 10: Claude Code adapter

**What to build:** The second real adapter, proving the contract wasn't accidentally shaped around OpenCode. A Claude Code teammate completes a scoped ticket end-to-end via headless invocation with JSON-schema-enforced TurnReport, persona injected through system-prompt flags, stream-json events parsed for outcomes, and typed retry telemetry (`api_retry` events carrying rate_limit/billing/authentication errors) mapped onto the rate-limit classification.

**Blocked by:** 04 Turn engine & TurnReport protocol (mock adapter), 05 Worktree provisioning & branch topology.

**Status:** ready-for-agent

- [ ] Completes a scoped ticket end-to-end in a scratch repo
- [ ] TurnReport enforced via JSON-schema output; violation treated as failed-retryable
- [ ] `api_retry` / typed error statuses mapped to the rate-limit classification path
- [ ] Permission mode configured for unsupervised operation inside the worktree
- [ ] Parity check: identical bundles produce equivalent behavior vs. the OpenCode adapter on shared fixtures
