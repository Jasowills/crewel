# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/JS (single landing page, no framework). Deployed via GitHub Pages from `site/`.

## Users

Primary: engineers who already run multiple coding agents (OpenCode, Claude Code, Codex) and want them working as one coordinated team instead of tab-switching between separate terminal windows. Secondary: OSS browsers evaluating whether to star/adopt.

## Product Purpose

Crewel is an open-source CLI that turns heterogeneous coding agents into one orchestrated team. A dedicated lead decomposes a request into tickets, delegates to teammates running in isolated git worktrees, reviews their output, and is the only instance that merges to main. Success = a user goes from `npm install` to prompting a lead in a 6-pane terminal in under 2 minutes.

## Positioning

Agent-agnostic: genuinely mixes OpenCode + Claude Code + Codex in one team under one protocol. Every existing alternative is single-vendor. The lead-only review/push model (teammates never touch main) is the second uncopiable claim.

## Operating Context

Developer's own machine, own repo, local terminal. Used during focused feature work; the user watches a multi-pane TUI while agents stream. Crewel embroidery is the namesake metaphor: many colored threads, one fabric.

## Capabilities and Constraints

- `crewel init` wizard → `crewel` launches 6 real PTY panes (lead 58% left, teammates 2+2+1 grid right) via OpenTUI + node-pty; works on Windows (ConPTY) and macOS (forkpty)
- Ticket-driven protocol with status/assignee/dependencies/acceptance criteria; `needs-clarification` is first-class
- Live `fs.watch` notifications; interrupt/stall-watchdog/rate-limit-pause/freeze-after-3-failures resilience
- Adapters: OpenCode, Claude Code, Codex, Mock. One file per new agent type.
- Constraint: no server, no dashboard in v0.x; everything under gitignored `.crewel/` is human-readable files.

## Brand Commitments

Name "crewel" (the embroidery pun is binding). Voice: dry, senior-engineer, no hype. The product's own vocabulary: lead, teammates, tickets, worktrees, integration branch, "stitched together".

## Evidence on Hand

Working v0.2.1 CLI (114 tests), verified quickstart, real 6-pane TUI screenshots possible from live runs. No testimonials, no benchmarks, no customer logos — none may be fabricated.

## Product Principles

1. Lead decides, teammates execute, human prompts once.
2. Isolation by default (worktrees); main is sacred.
3. Human-readable state over opaque tooling.
4. Agent-agnostic or it isn't Crewel.
5. Senior-bar behavior is protocol, not prompt-hope.

## Accessibility & Inclusion

Standard WCAG AA contrast; keyboard-navigable; reduced-motion respected.
