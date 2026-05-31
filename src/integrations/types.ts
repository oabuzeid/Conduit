/**
 * Ticket provider interface.
 *
 * Every ticket system (Linear, Jira, etc.) implements this interface.
 * To add a new provider:
 *   1. Create a file in src/integrations/ (e.g., asana.ts)
 *   2. Export a class implementing TicketProvider
 *   3. Register it in src/integrations/registry.ts
 */

export interface TicketItem {
  id: string;
  key: string; // display identifier, e.g., "ENG-123" or "PROJ-456"
  title: string;
  description: string;
  status: string;
  labels: string[];
  parentId?: string;
  parentKey?: string;
  updatedAt: string;
}

export interface CreateTicketInput {
  title: string;
  description: string;
  parentId?: string;
  labels?: string[];
  type?: "epic" | "story";
}

export interface UpdateTicketInput {
  id: string;
  title?: string;
  description?: string;
  labels?: string[];
  parentKey?: string; // pass to reparent (or empty string to detach)
}

export interface TicketProvider {
  /** Human-readable name, e.g. "Linear" or "Jira" */
  readonly name: string;

  /**
   * Resolve the project/team identifier from config into
   * whatever internal ID the provider needs.
   */
  resolveProject(projectKey: string): Promise<string>;

  /** Ensure a label exists and return its ID. */
  ensureLabel(projectId: string, name: string): Promise<string>;

  /** Create a ticket and return its ID + display key. */
  createTicket(
    projectId: string,
    input: CreateTicketInput
  ): Promise<{ id: string; key: string }>;

  /** Update an existing ticket. */
  updateTicket(input: UpdateTicketInput): Promise<void>;

  /** Fetch all tickets matching a label in the given project. */
  getTicketsByLabel(projectKey: string, label: string): Promise<TicketItem[]>;

  /** Serialize tickets into text for the AI engine. */
  ticketsToPromptContext(tickets: TicketItem[]): string;
}
