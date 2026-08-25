import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { getVersion, main, runCli } from "../src/cli.js";

const runGit = promisify(execFile);

describe("crewel CLI", () => {
  it("reports its version on --version", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(["--version"])).toBe(0);
    expect(log).toHaveBeenCalledWith(getVersion());
  });

  it("prints help by default", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main([])).toBe(0);
    expect(log.mock.calls.length).toBeGreaterThan(0);
  });

  it("exits 1 on unknown commands with an actionable message", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["nonsense"])).toBe(1);
    expect(err).toHaveBeenCalledWith('error: unknown command "nonsense"');
    log.mockRestore();
    err.mockRestore();
  });

  it("creates and inspects a team end-to-end in a git fixture", async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const repo = await mkdtemp(path.join(tmpdir(), "crewel-cli-"));
    try {
      await runGit("git", ["init", "-q"], { cwd: repo });
      const logs: string[] = [];
      vi.spyOn(console, "log").mockImplementation((m) => {
        logs.push(String(m));
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const exit = await runCli(
        ["team", "create", "demo", "--lead", "mock", "--teammates", "mock:2"],
        { repoRoot: repo }
      );
      expect(exit).toBe(0);
      expect(logs.some((line) => line.includes('created team "demo"'))).toBe(
        true
      );
      const config = JSON.parse(
        await readFile(
          path.join(repo, ".crewel", "teams", "demo", "config.json"),
          "utf8"
        )
      ) as { status: string; teammates: unknown[] };
      expect(config.status).toBe("active");
      expect(config.teammates).toHaveLength(2);

      const statusExit = await runCli(["team", "status"], {
        repoRoot: repo,
      });
      expect(statusExit).toBe(0);
      expect(logs.some((line) => line.includes("no tickets yet"))).toBe(true);
    } finally {
      vi.restoreAllMocks();
      await rm(repo, { recursive: true, force: true });
    }
  });
});
