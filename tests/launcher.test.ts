import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { launchTeamUI } from "../src/cli/launcher.js";

const runGit = promisify(execFile);

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "crewel-launcher-"));
  await runGit("git", ["init", "-q", "-b", "main"], { cwd: repo });
  await runGit("git", ["-C", repo, "config", "user.email", "t@t"]);
  await runGit("git", ["-C", repo, "config", "user.name", "t"]);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(repo, "seed.txt"), "seed\n");
  await runGit("git", ["-C", repo, "add", "."], { cwd: repo });
  await runGit("git", ["-C", repo, "commit", "-qm", "seed"]);
  const { createTeam } = await import("../src/core/team/index.js");
  await createTeam({
    repoRoot: repo,
    name: "demo",
    leadType: "mock",
    teammatesSpec: "mock:5",
  });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("launcher", () => {
  it("launches in non-TTY with 6 panes — lead focused", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // Force non-TTY
    const origIsTTY = process.stdout.isTTY;
    (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
    try {
      const code = await launchTeamUI(repo);
      expect(code).toBe(0);
      expect(
        log.mock.calls.some((c) =>
          String(c[0]).includes("lead:      mock (focused)")
        )
      ).toBe(true);
      expect(log.mock.calls.some((c) => String(c[0]).includes("mock-1"))).toBe(
        true
      );
      expect(
        log.mock.calls.some((c) => String(c[0]).includes("58% left"))
      ).toBe(true);
    } finally {
      (process.stdout as unknown as { isTTY: boolean }).isTTY =
        origIsTTY as boolean;
      log.mockRestore();
    }
  });

  it("fails gracefully with no active team", async () => {
    const emptyRepo = await mkdtemp(path.join(tmpdir(), "crewel-empty-"));
    await runGit("git", ["init", "-q"], { cwd: emptyRepo });
    await expect(launchTeamUI(emptyRepo)).rejects.toThrow(
      /No active team found/
    );
    await rm(emptyRepo, { recursive: true, force: true });
  });
});
