import type {
  TicketProvider,
  TicketItem,
  CreateTicketInput,
  UpdateTicketInput,
} from "./types.js";

function getConfig(): { host: string; email: string; token: string } {
  const host = process.env.JIRA_HOST; // e.g., "yourcompany.atlassian.net"
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!host || !email || !token) {
    throw new Error(
      "Jira credentials not set. Required env vars:\n" +
        "  JIRA_HOST (e.g., yourcompany.atlassian.net)\n" +
        "  JIRA_EMAIL (your Atlassian account email)\n" +
        "  JIRA_API_TOKEN (https://id.atlassian.com/manage-profile/security/api-tokens)"
    );
  }
  return { host, email, token };
}

async function jiraFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { host, email, token } = getConfig();
  const auth = Buffer.from(`${email}:${token}`).toString("base64");

  const res = await fetch(`https://${host}/rest/api/3${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira API error: ${res.status} ${res.statusText}\n${body}`);
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

export class JiraProvider implements TicketProvider {
  readonly name = "Jira";

  async resolveProject(projectKey: string): Promise<string> {
    const data = await jiraFetch<{ id: string; key: string }>(
      `/project/${projectKey}`
    );
    return data.id;
  }

  async ensureLabel(_projectId: string, name: string): Promise<string> {
    // Jira labels are strings, not entities with IDs.
    // They're created implicitly when assigned to an issue.
    return name;
  }

  async createTicket(
    projectId: string,
    input: CreateTicketInput
  ): Promise<{ id: string; key: string }> {
    // Determine issue type: if it has a parent, it's a Sub-task; otherwise Story.
    // For epics, the caller should handle the issuetype separately in the future.
    const issueType = input.parentId ? "Sub-task" : "Story";

    const fields: Record<string, unknown> = {
      project: { id: projectId },
      summary: input.title,
      description: toADF(input.description),
      issuetype: { name: issueType },
    };

    if (input.labels && input.labels.length > 0) {
      fields.labels = input.labels;
    }

    if (input.parentId) {
      fields.parent = { id: input.parentId };
    }

    const data = await jiraFetch<{ id: string; key: string }>("/issue", {
      method: "POST",
      body: JSON.stringify({ fields }),
    });

    return { id: data.id, key: data.key };
  }

  async updateTicket(input: UpdateTicketInput): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (input.title !== undefined) fields.summary = input.title;
    if (input.description !== undefined) {
      fields.description = toADF(input.description);
    }

    await jiraFetch(`/issue/${input.id}`, {
      method: "PUT",
      body: JSON.stringify({ fields }),
    });
  }

  async getTicketsByLabel(
    projectKey: string,
    label: string
  ): Promise<TicketItem[]> {
    const jql = `project = "${projectKey}" AND labels = "${label}" ORDER BY updated DESC`;
    const data = await jiraFetch<{
      issues: {
        id: string;
        key: string;
        fields: {
          summary: string;
          description: unknown;
          status: { name: string };
          labels: string[];
          parent?: { id: string; key: string };
          updated: string;
        };
      }[];
    }>(`/search?jql=${encodeURIComponent(jql)}&maxResults=100`);

    return data.issues.map((issue) => ({
      id: issue.id,
      key: issue.key,
      title: issue.fields.summary,
      description: fromADF(issue.fields.description),
      status: issue.fields.status.name,
      labels: issue.fields.labels,
      parentId: issue.fields.parent?.id,
      parentKey: issue.fields.parent?.key,
      updatedAt: issue.fields.updated,
    }));
  }

  ticketsToPromptContext(tickets: TicketItem[]): string {
    return tickets
      .map((t) => {
        const parent = t.parentKey ? `Parent: ${t.parentKey}` : "Top-level";
        return `[${t.key}] ${t.title}\nStatus: ${t.status} | Labels: ${t.labels.join(", ")} | ${parent}\n${t.description || "(no description)"}`;
      })
      .join("\n---\n");
  }
}

/**
 * Convert plain text / markdown to Atlassian Document Format (ADF).
 * This is a minimal conversion — handles paragraphs and line breaks.
 * A full markdown-to-ADF converter would be a separate module.
 */
function toADF(text: string): object {
  const paragraphs = text.split(/\n\n+/).map((block) => ({
    type: "paragraph",
    content: block.split("\n").flatMap((line, i, arr) => {
      const nodes: object[] = [{ type: "text", text: line }];
      if (i < arr.length - 1) {
        nodes.push({ type: "hardBreak" });
      }
      return nodes;
    }),
  }));

  return {
    version: 1,
    type: "doc",
    content: paragraphs,
  };
}

/**
 * Extract plain text from ADF. Lossy but good enough for diffing.
 */
function fromADF(adf: unknown): string {
  if (!adf || typeof adf !== "object") return "";

  const doc = adf as { content?: { content?: { text?: string }[] }[] };
  if (!doc.content) return "";

  return doc.content
    .map((block) =>
      (block.content ?? [])
        .map((node) => node.text ?? "")
        .join("")
    )
    .join("\n\n");
}
