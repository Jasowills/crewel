# 03: Direct-mode tickets & board view

**What to build:** The "Jason defines tickets directly" mode end-to-end: hand-author tickets as Markdown with YAML frontmatter (id/title/status/deps/acceptance criteria), run `crewel tickets validate` to catch anything malformed _before_ a team ever runs, and render the board with `crewel team tickets`. Humans author Markdown; machines read normalized JSON twins on disk.

**Blocked by:** 02 Team creation & on-disk state.

**Status:** done

- [x] A valid frontmatter ticket normalizes to its internal JSON form in the tickets directory
- [x] Validate reports every malformed field and unresolvable dependency reference with enough context to fix it; non-zero exit on problems
- [x] Dependency edges must reference existing ticket ids (no dangling blockers)
- [x] Board renders all lifecycle columns: open / assigned / in-progress / needs-clarification / in-review / blocked / done, with assignees visible
