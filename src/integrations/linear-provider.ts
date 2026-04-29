import type {
  TicketProvider,
  TicketItem,
  CreateTicketInput,
  UpdateTicketInput,
} from "./types.js";

const LINEAR_API = "https://api.linear.app/graphql";

function getApiKey(): string {
  const key = process.env.LINEAR_API_KEY;
  if (!key) {
    throw new Error(
      "LINEAR_API_KEY not set. Get one at: https://linear.app/settings/api"
    );
  }
  return key;
}

async function gql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getApiKey(),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Linear API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    data: T;
    errors?: { message: string }[];
  };
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
  }
  return json.data;
}

export class LinearProvider implements TicketProvider {
  readonly name = "Linear";

  async resolveProject(teamKey: string): Promise<string> {
    const data = await gql<{
      teams: { nodes: { id: string; key: string }[] };
    }>(`query { teams { nodes { id key } } }`);

    const team = data.teams.nodes.find(
      (t) => t.key.toLowerCase() === teamKey.toLowerCase()
    );
    if (!team) {
      const available = data.teams.nodes.map((t) => t.key).join(", ");
      throw new Error(
        `Linear team "${teamKey}" not found. Available: ${available}`
      );
    }
    return team.id;
  }

  async ensureLabel(teamId: string, name: string): Promise<string> {
    const data = await gql<{
      issueLabels: { nodes: { id: string; name: string }[] };
    }>(
      `query($teamId: String!) {
        issueLabels(filter: { team: { id: { eq: $teamId } } }) {
          nodes { id name }
        }
      }`,
      { teamId }
    );

    const existing = data.issueLabels.nodes.find(
      (l) => l.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return existing.id;

    const create = await gql<{
      issueLabelCreate: { issueLabel: { id: string } };
    }>(
      `mutation($input: IssueLabelCreateInput!) {
        issueLabelCreate(input: $input) { issueLabel { id } }
      }`,
      { input: { name, teamId } }
    );
    return create.issueLabelCreate.issueLabel.id;
  }

  async createTicket(
    teamId: string,
    input: CreateTicketInput
  ): Promise<{ id: string; key: string }> {
    const data = await gql<{
      issueCreate: { issue: { id: string; identifier: string } };
    }>(
      `mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          issue { id identifier }
        }
      }`,
      {
        input: {
          title: input.title,
          description: input.description,
          teamId,
          parentId: input.parentId,
          labelIds: input.labels,
        },
      }
    );
    return {
      id: data.issueCreate.issue.id,
      key: data.issueCreate.issue.identifier,
    };
  }

  async updateTicket(input: UpdateTicketInput): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (input.title !== undefined) fields.title = input.title;
    if (input.description !== undefined) fields.description = input.description;

    await gql(
      `mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { issue { id } }
      }`,
      { id: input.id, input: fields }
    );
  }

  async getTicketsByLabel(
    teamKey: string,
    labelName: string
  ): Promise<TicketItem[]> {
    const data = await gql<{
      issues: {
        nodes: {
          id: string;
          identifier: string;
          title: string;
          description: string;
          state: { name: string };
          labels: { nodes: { name: string }[] };
          parent: { id: string; identifier: string } | null;
          updatedAt: string;
        }[];
      };
    }>(
      `query($teamKey: String!, $label: String!) {
        issues(filter: {
          team: { key: { eq: $teamKey } },
          labels: { name: { eq: $label } }
        }) {
          nodes {
            id identifier title description
            state { name }
            labels { nodes { name } }
            parent { id identifier }
            updatedAt
          }
        }
      }`,
      { teamKey, label: labelName }
    );

    return data.issues.nodes.map((issue) => ({
      id: issue.id,
      key: issue.identifier,
      title: issue.title,
      description: issue.description ?? "",
      status: issue.state.name,
      labels: issue.labels.nodes.map((l) => l.name),
      parentId: issue.parent?.id,
      parentKey: issue.parent?.identifier,
      updatedAt: issue.updatedAt,
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
