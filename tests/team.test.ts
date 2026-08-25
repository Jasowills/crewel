import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTeam, teamStatus } from "../src/core/team/index.js";

const runGit = promisify(execFile);

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "crewel-team-"));
  await runGit("git", ["init", "-q"], { cwd: repo });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

function makeTeamInput(name: string) {
  return {
    repoRoot: repo,
    name,
    leadType: "mock",
    teammatesSpec: "mock:2",
  };
}

describe("createTeam", () => {
  it("writes inspectable team state under the coordination dir", async () => {
    const config = await createTeam(makeTeamInput("login-flow"));
    expect(config.name).toBe("login-flow");
    expect(config.lead.type).toBe("mock");
    expect(config.teammates.map((t) => t.id)).toEqual(["mock-1", "mock-2"]);
    const raw = JSON.parse(
      await readFile(
        path.join(repo, ".crewel", "teams", "login-flow", "config.json"),
        "utf8"
      )
    ) as { version: number; status: string; createdAt: string };
    expect(raw.version).toBe(1);
    expect(raw.status).toBe("active");
    expect(raw.createdAt).toBeTruthy();
  });

  it("adds .crewel/ to the repo .gitignore exactly once", async () => {
    await writeFile(path.join(repo, ".gitignore"), "node_modules/\n", "utf8");
    await createTeam(makeTeamInput("a"));
    let ignored = await readFile(path.join(repo, ".gitignore"), "utf8");
    expect(ignored).toContain(".crewel/");
    expect(ignored.match(/\.crewel\//g)).toHaveLength(1);

    // Idempotent even when called again through the same path.
    const { appendGitIgnoreEntry } = await import("../src/core/team/store.js");
    await appendGitIgnoreEntry(repo);
    ignored = await readFile(path.join(repo, ".gitignore"), "utf8");
    expect(ignored.match(/\.crewel\//g)).toHaveLength(1);
  });

  it("rejects invalid team names", async () => {
    await expect(createTeam(makeTeamInput("Bad_Name"))).rejects.toThrow(
      /lowercase letters, digits, and hyphens/
    );
  });

  it("rejects empty teammate rosters", async () => {
    await expect(
      createTeam({ ...makeTeamInput("lonely"), teammatesSpec: "" })
    ).rejects.toThrow(/at least one teammate/);
  });

  it("rejects malformed teammate entries", async () => {
    await expect(
      createTeam({ ...makeTeamInput("x"), teammatesSpec: "mock" })
    ).rejects.toThrow(/expected type:count/);
    await expect(
      createTeam({ ...makeTeamInput("x"), teammatesSpec: "mock:0" })
    ).rejects.toThrow(/integer >= 1/);
  });

  it("rejects unknown adapter types and lists known types", async () => {
    await expect(
      createTeam({
        ...makeTeamInput("ghost"),
        leadType: "claude-code",
      })
    ).rejects.toThrow(/unknown adapter type "claude-code"/);
    await expect(
      createTeam({
        ...makeTeamInput("ghost"),
        leadType: "claude-code",
      })
    ).rejects.toThrow(/known types: mock/);
  });

  it("refuses to run outside a git repository", async () => {
    const plain = await mkdtemp(path.join(tmpdir(), "crewel-plain-"));
    try {
      await expect(
        createTeam({ ...makeTeamInput("nope"), repoRoot: plain })
      ).rejects.toThrow(/not inside a git repository/);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it("enforces one active team per repo", async () => {
    await createTeam(makeTeamInput("first"));
    await expect(createTeam(makeTeamInput("second"))).rejects.toThrow(
      /team "first" is already active/
    );
  });

  it("creates nested ticket dirs lazily but team dir eagerly", async () => {
    await createTeam(makeTeamInput("dirs"));
    const stat = await readFile(
      path.join(repo, ".crewel", "teams", "dirs", "config.json"),
      "utf8"
    );
    expect(stat).toContain('"name": "dirs"');
  });
});

describe("teamStatus", () => {
  it("summarizes composition and an empty board", async () => {
    await createTeam(makeTeamInput("statusful"));
    const { config, board } = await teamStatus({ repoRoot: repo });
    expect(config.name).toBe("statusful");
    expect(board.total).toBe(0);
    expect(board.byStatus["open"]).toBe(0);
    expect(board.byStatus["done"]).toBe(0);
  });

  it("counts tickets by lifecycle status once they exist", async () => {
    await createTeam(makeTeamInput("busy"));
    const ticketsDir = path.join(repo, ".crewel", "teams", "busy", "tickets");
    await mkdir(ticketsDir, { recursive: true });
    await writeFile(
      path.join(ticketsDir, "t1.json"),
      JSON.stringify({ id: "t1", status: "open" }),
      "utf8"
    );
    await writeFile(
      path.join(ticketsDir, "t2.json"),
      JSON.stringify({ id: "t2", status: "in-progress" }),
      "utf8"
    );
    const { board } = await teamStatus({ repoRoot: repo });
    expect(board.total).toBe(2);
    expect(board.byStatus["open"]).toBe(1);
    expect(board.byStatus["in-progress"]).toBe(1);
  });

  it("errors when no active team exists", async () => {
    await expect(teamStatus({ repoRoot: repo })).rejects.toThrow(
      /no active team found/
    );
  });

  it("errors when named team does not exist", async () => {
    await createTeam(makeTeamInput("here"));
    await expect(
      teamStatus({ repoRoot: repo, name: "missing" })
    ).rejects.toThrow(/no team named "missing"/);
  });
});
