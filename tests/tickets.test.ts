import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { board, validateTickets } from "../src/core/tickets/index.js";
import { createTeam } from "../src/core/team/index.js";

const runGit = promisify(execFile);

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "crewel-tickets-"));
  await runGit("git", ["init", "-q"], { cwd: repo });
  await createTeam({
    repoRoot: repo,
    name: "demo",
    leadType: "mock",
    teammatesSpec: "mock:2",
  });
  await mkdir(path.join(repo, ".crewel", "teams", "demo", "tickets"), {
    recursive: true,
  });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

function ticketsDir(): string {
  return path.join(repo, ".crewel", "teams", "demo", "tickets");
}

async function writeTicket(file: string, content: string): Promise<void> {
  await writeFile(path.join(ticketsDir(), file), content, "utf8");
}

const T1 = `---
id: t1
title: Set up auth schema
accepts:
  - migration runs
---
Do the database part.
`;

const T2 = `---
id: t2
title: Login endpoint
status: assigned
assignee: mock-1
depends:
  - t1
accepts:
  - POST /login returns a token
  - bad credentials rejected
---
Build the login route on top of t1.
`;

describe("validateTickets", () => {
  it("normalizes valid Markdown tickets to JSON twins", async () => {
    await writeTicket("t1.md", T1);
    await writeTicket("t2.md", T2);
    const { written } = await validateTickets({ repoRoot: repo, team: "demo" });
    expect(written).toBe(2);
    const twin = JSON.parse(
      await readFile(path.join(ticketsDir(), "t2.json"), "utf8")
    ) as Record<string, unknown>;
    expect(twin["title"]).toBe("Login endpoint");
    expect(twin["status"]).toBe("assigned");
    expect(twin["assignee"]).toBe("mock-1");
    expect(twin["dependsOn"]).toEqual(["t1"]);
    expect(twin["scope"]).toBe("Build the login route on top of t1.");
    const first = JSON.parse(
      await readFile(path.join(ticketsDir(), "t1.json"), "utf8")
    ) as Record<string, unknown>;
    expect(first["status"]).toBe("open");
    expect(first["dependsOn"]).toEqual([]);
  });

  it("is idempotent across repeated validation", async () => {
    await writeTicket("t1.md", T1);
    await validateTickets({ repoRoot: repo, team: "demo" });
    const again = await validateTickets({ repoRoot: repo, team: "demo" });
    expect(again.written).toBe(1);
  });

  it("reports structural frontmatter problems with file context", async () => {
    await writeTicket("broken.md", "no frontmatter here");
    await expect(
      validateTickets({ repoRoot: repo, team: "demo" })
    ).rejects.toThrow(/broken\.md: must start with a --- frontmatter block/);

    await writeTicket("unclosed.md", "---\nid: unclosed\naccepts:\n  - x\n");
    await expect(
      validateTickets({ repoRoot: repo, team: "demo" })
    ).rejects.toThrow(/unclosed\.md: frontmatter block never closes/);
  });

  it("aggregates every field problem in one report", async () => {
    await writeTicket(
      "bad.md",
      `---
id: bad
depend:
  - t9
---
`
    );
    const err = (await validateTickets({
      repoRoot: repo,
      team: "demo",
    }).catch((e: unknown) => e as Error)) as Error;
    expect(err.message).toMatch(/missing required field "title"/);
    expect(err.message).toMatch(/missing "accepts"/);
    expect(err.message).toMatch(/unknown field "depend"/);
  });

  it("rejects invalid lifecycle statuses", async () => {
    await writeTicket(
      "s.md",
      `---
id: s
title: Odd status
status: finished
accepts:
  - x
---
`
    );
    await expect(
      validateTickets({ repoRoot: repo, team: "demo" })
    ).rejects.toThrow(/"status" must be one of/);
  });

  it("rejects dangling dependencies and self-dependencies", async () => {
    await writeTicket("t1.md", T1);
    await writeTicket(
      "t3.md",
      `---
id: t3
title: Ghost dep
depends:
  - nonexistent
accepts:
  - x
---
`
    );
    await expect(
      validateTickets({ repoRoot: repo, team: "demo" })
    ).rejects.toThrow(/depends on unknown ticket "nonexistent"/);

    await rm(path.join(ticketsDir(), "t3.md"));
    await writeTicket(
      "loop.md",
      `---
id: loop
title: Self loop
depends:
  - loop
accepts:
  - x
---
`
    );
    await expect(
      validateTickets({ repoRoot: repo, team: "demo" })
    ).rejects.toThrow(/cannot depend on itself/);
  });

  it("requires ids to match file names and rejects duplicates", async () => {
    await writeTicket("mismatch.md", T1.replace("id: t1", "id: other"));
    await expect(
      validateTickets({ repoRoot: repo, team: "demo" })
    ).rejects.toThrow(/must match its file name \(mismatch\.md\)/);

    await rm(path.join(ticketsDir(), "mismatch.md"));
    await writeTicket("dup.md", T1);
    await writeTicket("dup.json", "{}"); // non-md ignored for id checks
    await writeTicket("t1-copy.md", T1);
    const err = (await validateTickets({
      repoRoot: repo,
      team: "demo",
    }).catch((e: unknown) => e as Error)) as Error;
    expect(err.message).toMatch(/duplicate ticket id "t1"/);
  });

  it("errors when there is nothing to validate", async () => {
    await expect(
      validateTickets({ repoRoot: repo, team: "demo" })
    ).rejects.toThrow(/no ticket files found/);
    await expect(
      validateTickets({ repoRoot: repo, team: "ghost-team" })
    ).rejects.toThrow(/no tickets directory found for team "ghost-team"/);
  });
});

describe("board", () => {
  it("renders all lifecycle columns with assignees visible", async () => {
    await writeTicket("t1.md", T1);
    await writeTicket("t2.md", T2);
    await validateTickets({ repoRoot: repo, team: "demo" });

    // Simulate progress on t1 without re-validating.
    const twinPath = path.join(ticketsDir(), "t1.json");
    const twin = JSON.parse(await readFile(twinPath, "utf8")) as Record<
      string,
      unknown
    >;
    twin["status"] = "done";
    await writeFile(twinPath, JSON.stringify(twin, null, 2), "utf8");

    const result = await board({ repoRoot: repo, team: "demo" });
    expect(result.total).toBe(2);
    expect(result.columns).toHaveLength(7);
    const done = result.columns.find((c) => c.status === "done");
    expect(done?.tickets.map((t) => t.id)).toEqual(["t1"]);
    const assigned = result.columns.find((c) => c.status === "assigned");
    expect(assigned?.tickets[0]?.assignee).toBe("mock-1");
    expect(assigned?.tickets[0]?.title).toBe("Login endpoint");
  });
});
