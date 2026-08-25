# 01: Toolchain bootstrap

**What to build:** The project baseline that every other ticket stands on: `crewel --version` runs as a real CLI entry point, with a green, enforced quality gate behind it — strict TypeScript ESM, vitest wired and passing, lint/format/typecheck clean, all enforced by a pre-commit hook.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `crewel --version` prints the current version via the CLI entry point
- [ ] `npm test` runs vitest with at least one passing smoke test exercising the CLI entry point
- [ ] `npm run lint` and `npm run typecheck` pass clean
- [ ] Pre-commit hook runs formatting, lint, typecheck, and tests (Husky + lint-staged pattern)
- [ ] `engines` requires Node ≥20; ESM throughout
