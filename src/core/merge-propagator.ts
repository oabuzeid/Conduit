import { getPendingPR, removePendingPR } from "./pending-prs.js";
import { recordSelfWrite, CONDUIT_WRITE_MARKER } from "./loop-guard.js";

export interface PropagationResult {
  propagated_to: string[];
  skipped: string[];
}

export async function propagateMerge(pr_number: number): Promise<PropagationResult> {
  const pending = getPendingPR(pr_number);
  if (!pending) {
    return { propagated_to: [], skipped: [`No pending record for PR #${pr_number} — nothing to propagate`] };
  }

  const propagated: string[] = [];
  const skipped: string[] = [];
  const event = pending.triggering_event;
  const prUrl = `https://github.com/${pending.repo.owner}/${pending.repo.name}/pull/${pr_number}`;

  if (event.source === "jira" && "ticket_id" in event) {
    const comment = buildTicketComment(event.ticket_id, pending.target_spec_file, prUrl);
    await postJiraComment(event.ticket_id, comment);
    recordSelfWrite({ kind: "ticket_update", ticket_id: event.ticket_id });
    propagated.push(`Jira comment on ${event.ticket_id}`);
  } else if (event.source === "linear" && "ticket_id" in event) {
    skipped.push("Linear comment posting not yet implemented");
  } else if (event.source === "figma") {
    skipped.push("Figma frame annotation not yet implemented");
  } else if (event.source === "github") {
    skipped.push("SpecMergeEvent has no downstream propagation");
  }

  removePendingPR(pr_number);
  return { propagated_to: propagated, skipped };
}

function buildTicketComment(ticketId: string, specFile: string, prUrl: string): string {
  return (
    `${CONDUIT_WRITE_MARKER} The spec section that maps to ${ticketId} has been updated to match this ticket's revised content.\n\n` +
    `Spec file: ${specFile}\n` +
    `Merged PR: ${prUrl}`
  );
}

async function postJiraComment(ticketId: string, body: string): Promise<void> {
  const host = process.env.JIRA_HOST;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!host || !email || !token) {
    throw new Error("Jira credentials missing — cannot post propagation comment");
  }
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const res = await fetch(`https://${host}/rest/api/3/issue/${ticketId}/comment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      body: {
        version: 1,
        type: "doc",
        content: body.split("\n").map((line) => ({
          type: "paragraph",
          content: line ? [{ type: "text", text: line }] : [],
        })),
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Jira comment POST failed: ${res.status} ${res.statusText}\n${await res.text()}`);
  }
}
