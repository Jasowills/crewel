import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { CrewelError } from "../errors.js";
import { teamDir } from "../team/store.js";

export interface MailMessage {
  id: string;
  from: string;
  to: string;
  kind:
    "assignment" | "clarification" | "clarification-answer" | "peer" | "system";
  body: string;
  createdAt: string;
}

function mailboxDir(
  repoRoot: string,
  team: string,
  participant: string
): string {
  return path.join(teamDir(repoRoot, team), "messages", participant);
}

let counter = 0;

export async function sendMessage(input: {
  repoRoot: string;
  team: string;
  from: string;
  to: string;
  kind: MailMessage["kind"];
  body: string;
}): Promise<MailMessage> {
  counter += 1;
  const message: MailMessage = {
    id: `${Date.now().toString(36)}-${counter}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    from: input.from,
    to: input.to,
    kind: input.kind,
    body: input.body,
    createdAt: new Date().toISOString(),
  };
  const dir = mailboxDir(input.repoRoot, input.team, input.to);
  await mkdir(dir, { recursive: true });
  await appendFile(
    path.join(dir, "inbox.jsonl"),
    `${JSON.stringify(message)}\n`,
    "utf8"
  );
  return message;
}

export async function drainInbox(
  repoRoot: string,
  team: string,
  participant: string
): Promise<MailMessage[]> {
  const inboxPath = path.join(
    mailboxDir(repoRoot, team, participant),
    "inbox.jsonl"
  );
  let raw: string;
  try {
    raw = await readFile(inboxPath, "utf8");
  } catch {
    return [];
  }
  const messages: MailMessage[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      messages.push(JSON.parse(line) as MailMessage);
    } catch {
      throw new CrewelError(
        `corrupt mailbox line for "${participant}" — fix or remove ${inboxPath}`
      );
    }
  }
  if (messages.length > 0) {
    const archivePath = path.join(
      mailboxDir(repoRoot, team, participant),
      "archive.jsonl"
    );
    await appendFile(
      archivePath,
      messages.map((m) => JSON.stringify(m)).join("\n") + "\n",
      "utf8"
    );
  }
  await writeFile(inboxPath, "", "utf8");
  return messages;
}
