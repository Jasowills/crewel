import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { teamDir } from "../team/store.js";
import { atomicWriteFile, withFileLock } from "../team/lock.js";

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
  const inboxPath = path.join(dir, "inbox.jsonl");
  // File write = delivered; disk-full/EACCES will throw to caller (delivery error)
  await withFileLock(inboxPath, async () => {
    await appendFile(inboxPath, `${JSON.stringify(message)}\n`, "utf8");
  });
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
  return withFileLock(inboxPath, async () => {
    let raw: string;
    try {
      raw = await readFile(inboxPath, "utf8");
    } catch {
      return [];
    }
    const messages: MailMessage[] = [];
    const validLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const msg = JSON.parse(line) as MailMessage;
        messages.push(msg);
        validLines.push(line);
      } catch {
        // Malformed entry: report and remove (Claude pre-2.1.207 blocked, now removed)
        console.warn(
          `[crewel] corrupt mailbox line for "${participant}" — skipping: ${line.slice(0, 120)}`
        );
      }
    }
    if (messages.length > 0) {
      const archivePath = path.join(
        mailboxDir(repoRoot, team, participant),
        "archive.jsonl"
      );
      await appendFile(archivePath, validLines.join("\n") + "\n", "utf8");
    } else if (validLines.length === 0 && raw.trim() !== "") {
      // All lines were corrupt — still truncate to avoid loop
      console.warn(
        `[crewel] all mailbox lines for "${participant}" were corrupt — truncating ${inboxPath}`
      );
    }
    await atomicWriteFile(inboxPath, "", "utf8");
    return messages;
  });
}
