# 06: Live notifications

**What to build:** Push-not-poll, made real: file-watchers over the coordination layer mean every relevant state change — assignment, completion, blocker, rate-limit pause, review request — lands in `jason.log` and wakes a live `crewel team watch` tail within perceptible immediacy, whether the watcher started before or after the events fired. Teammate-to-teammate and lead-to-teammate deliveries wake their recipients the same way.

**Blocked by:** 04 Turn engine & TurnReport protocol (mock adapter).

**Status:** done

- [x] State changes appear in `crewel team watch` output immediately, no polling timer involved
- [x] `jason.log` is append-only, timestamped, human-readable
- [x] Peer and lead notifications wake the intended recipient's next turn (provable with mock adapters)
- [x] Watching works regardless of whether the tail started before or after the event
