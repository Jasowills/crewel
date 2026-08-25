import { parse } from "yaml";
import { CrewelError } from "../errors.js";

export interface ParsedTicketDoc {
  frontmatter: Record<string, unknown>;
  body: string;
}

const OPENING = "---\n";

export function parseTicketDoc(
  source: string,
  fileName: string
): ParsedTicketDoc {
  if (!source.startsWith(OPENING)) {
    throw new CrewelError(
      `${fileName}: must start with a --- frontmatter block`
    );
  }
  const rest = source.slice(OPENING.length);
  const closeIndex = rest.indexOf("\n---");
  if (closeIndex === -1) {
    throw new CrewelError(
      `${fileName}: frontmatter block never closes — expected a --- line after the fields`
    );
  }
  const head = rest.slice(0, closeIndex);
  const afterClose = rest.slice(closeIndex + "\n---".length);
  if (!afterClose.startsWith("\n") && afterClose !== "") {
    throw new CrewelError(
      `${fileName}: malformed closing frontmatter delimiter`
    );
  }
  let parsed: unknown;
  try {
    parsed = parse(head);
  } catch (error) {
    throw new CrewelError(
      `${fileName}: invalid YAML frontmatter — ${(error as Error).message}`
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CrewelError(
      `${fileName}: frontmatter must be a mapping of fields`
    );
  }
  const body = afterClose.replace(/^\n/, "").trim();
  return { frontmatter: parsed as Record<string, unknown>, body };
}
