export const TICKET_LIFECYCLE = [
  "open",
  "assigned",
  "in-progress",
  "needs-clarification",
  "in-review",
  "blocked",
  "done",
] as const;

export type TicketStatus = (typeof TICKET_LIFECYCLE)[number];

export function isTicketStatus(value: unknown): value is TicketStatus {
  return (
    typeof value === "string" &&
    (TICKET_LIFECYCLE as readonly string[]).includes(value)
  );
}

export const TICKET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface Ticket {
  id: string;
  title: string;
  status: TicketStatus;
  assignee?: string;
  dependsOn: string[];
  acceptanceCriteria: string[];
  scope?: string;
}
