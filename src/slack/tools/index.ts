import { readFileSync, existsSync } from "fs";
import { Octokit } from "@octokit/rest";
import type { ConduitConfig } from "../../core/config.js";
import { loadSpecs, parseSpec } from "../../core/spec-parser.js";
import { scanSpecForAmbiguity } from "../../core/ambiguity-scanner.js";
import { generateTickets, type GeneratedTicket } from "../../core/ai-engine.js";
import { routeFor } from "../../core/router.js";
import { getProvider } from "../../integrations/registry.js";
import { loadState, saveState, addMapping, hashContent } from "../../core/state.js";
import { fetchSpecFromUrl } from "../../core/spec-fetcher.js";
import { getFigmaTree, parseFigmaUrl, buildFrameCatalog } from "../../integrations/figma.js";
import type { Session, FigmaFrameRef } from "../session.js";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "ingest_spec",
    description: "Load a product spec into the session. Accepts pasted markdown, a relative path to a markdown file in the repo (e.g. 'specs/payments/checkout.md'), or a public Google Doc URL ('anyone with the link can view'). Call this once at the start of a session, or to switch specs.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["paste", "file_path", "url"], description: "How the spec is being supplied. 'url' currently supports public Google Docs only." },
        content: { type: "string", description: "The markdown content (paste), the file path (file_path), or the URL (url)." },
      },
      required: ["source", "content"],
    },
  },
  {
    name: "scan_spec",
    description: "Run the ambiguity scanner on the currently-loaded spec. Returns findings the PM should review before generating tickets. No arguments — uses the session's loaded spec.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "set_destination",
    description: "Override the default Jira/Linear project for tickets generated in this session. Use when the user explicitly names a destination (e.g. 'put these in BACK'). Pass the project key as a string.",
    input_schema: {
      type: "object",
      properties: { project_key: { type: "string" } },
      required: ["project_key"],
    },
  },
  {
    name: "set_tone",
    description: "Override the default tone for ticket generation in this session. Pass a short directive like 'more concise', 'less formal', 'include more context for engineers new to the project'.",
    input_schema: {
      type: "object",
      properties: { directive: { type: "string" } },
      required: ["directive"],
    },
  },
  {
    name: "attach_context",
    description: "Attach an external reference (Figma URL, Slack message link, document link) or a short note that should inform subsequent ticket generation. Multiple attachments accumulate.",
    input_schema: {
      type: "object",
      properties: { url_or_note: { type: "string" } },
      required: ["url_or_note"],
    },
  },
  {
    name: "generate_tickets",
    description: "Run ticket generation on the currently-loaded spec. Produces a draft list — does NOT push to Jira/Linear yet. Returns a summary the user can review. Call after the user has confirmed they're ready to see a draft.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "update_breakdown",
    description: "Modify the draft tickets in this session before push. Pass a JSON object describing the edit: { 'remove': [titles to drop], 'edit': [{title, new_title?, new_description?}], 'add': [{title, description, parent_title?}] }.",
    input_schema: {
      type: "object",
      properties: { edits: { type: "string", description: "JSON-stringified edit object" } },
      required: ["edits"],
    },
  },
  {
    name: "push_tickets",
    description: "Actually create the draft tickets in Jira/Linear. Only call after the user has explicitly approved the breakdown. Returns the created ticket IDs and URLs.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_jira_ticket",
    description: "Create a single ticket directly in Jira (epic or story), outside the bulk-generate flow. Use this when the PM asks to add a one-off epic or story to an already-pushed set — e.g. 'create a new epic called X to group these under.' Returns the created ticket key.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        type: { type: "string", enum: ["epic", "story"] },
        project_key: { type: "string", description: "Optional. Defaults to the session destination or the conduit.yaml default." },
        parent_key: { type: "string", description: "Optional. If creating a story, the epic key it should sit under (e.g. SCRUM-12)." },
      },
      required: ["title", "description", "type"],
    },
  },
  {
    name: "save_spec_to_repo",
    description: "Commit the session's spec to the conduit repo so reverse-direction sync (v0.2) has a real spec file to edit when tickets change in Jira later. Call this when the spec came from a Slack paste or file upload — without it, ticket edits in Jira can't be propagated back to a spec because no real spec file exists. After this runs, any tickets already pushed in this session get their state.json mappings updated to point at the new path. Idempotent: re-running with the same path overwrites.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative target path, e.g. 'specs/avatar-upload.md'. If omitted, auto-derived from the spec's H1 title." },
        commit_message: { type: "string", description: "Optional commit message. Defaults to 'docs: add spec via Slack session'." },
      },
    },
  },
  {
    name: "change_jira_parent",
    description: "Reparent an existing Jira ticket. Use this when the PM wants to move stories under a different epic — e.g. 'move SCRUM-45 and SCRUM-46 under the new epic SCRUM-50.' Pass an empty string as new_parent_key to detach from any epic.",
    input_schema: {
      type: "object",
      properties: {
        ticket_keys: { type: "array", items: { type: "string" }, description: "List of ticket keys to reparent (e.g. ['SCRUM-45', 'SCRUM-46'])" },
        new_parent_key: { type: "string", description: "Epic key the tickets should sit under, or empty string to detach." },
      },
      required: ["ticket_keys", "new_parent_key"],
    },
  },
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  session: Session,
  config: ConduitConfig
): Promise<string> {
  switch (name) {
    case "ingest_spec": return ingestSpec(input as { source: string; content: string }, session);
    case "scan_spec": return scanSpec(session, config);
    case "set_destination": return setDestination(input as { project_key: string }, session, config);
    case "set_tone": return setTone(input as { directive: string }, session);
    case "attach_context": return attachContext(input as { url_or_note: string }, session);
    case "generate_tickets": return generateTicketsTool(session, config);
    case "update_breakdown": return updateBreakdown(input as { edits: string }, session);
    case "push_tickets": return pushTickets(session, config);
    case "create_jira_ticket": return createJiraTicket(input as { title: string; description: string; type: "epic" | "story"; project_key?: string; parent_key?: string }, session, config);
    case "change_jira_parent": return changeJiraParent(input as { ticket_keys: string[]; new_parent_key: string }, config);
    case "save_spec_to_repo": return saveSpecToRepo(input as { path?: string; commit_message?: string }, session, config);
    default: return `Unknown tool: ${name}`;
  }
}

async function ingestSpec(input: { source: string; content: string }, session: Session): Promise<string> {
  if (input.source === "file_path") {
    if (!existsSync(input.content)) return `File not found: ${input.content}`;
    session.spec_text = readFileSync(input.content, "utf-8");
    session.spec_file_path = input.content;
  } else if (input.source === "url") {
    try {
      const fetched = await fetchSpecFromUrl(input.content);
      session.spec_text = fetched.content;
      session.spec_file_path = undefined;
      session.attached_urls.push(`spec source: ${fetched.source_url}`);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  } else {
    session.spec_text = input.content;
    session.spec_file_path = undefined;
  }
  const sectionCount = session.spec_text.split(/\n##\s/).length - 1;
  const sourceLabel = input.source === "url" ? `URL (${input.content})` : input.source;
  return `Loaded spec from ${sourceLabel} — ${session.spec_text.length} chars, ~${sectionCount} H2 sections.`;
}

async function scanSpec(session: Session, config: ConduitConfig): Promise<string> {
  if (!session.spec_text) return "No spec loaded yet — call ingest_spec first.";
  const spec = synthSpec(session);
  const findings = await scanSpecForAmbiguity(spec, config);
  session.scan_findings_count = findings.length;
  if (findings.length === 0) return "No ambiguities flagged. Spec looks clean.";
  return `Found ${findings.length} ambiguity finding(s):\n` +
    findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.kind} in "${f.section}": ${f.reason} (fix: ${f.suggested_fix})`).join("\n");
}

function setDestination(input: { project_key: string }, session: Session, config: ConduitConfig): string {
  session.destination = input.project_key;
  const route = routeFor({ spec_file: session.spec_file_path ?? "session.md", section_title: "_", ticket_labels: config.tickets.labels }, config);
  if (route !== input.project_key) {
    return `Set destination to "${input.project_key}". Note: this differs from what conduit.yaml's default routing would choose ("${route}").`;
  }
  return `Set destination to "${input.project_key}".`;
}

function setTone(input: { directive: string }, session: Session): string {
  session.tone = input.directive;
  return `Tone override set: "${input.directive}". Applies to the next generate_tickets call.`;
}

async function attachContext(input: { url_or_note: string }, session: Session): Promise<string> {
  session.attached_urls.push(input.url_or_note);

  // If this is a Figma URL, fetch the file tree and stash the frame catalog so
  // generate_tickets can reference real frames in AC instead of just dropping
  // the URL into the description.
  const figma = parseFigmaUrl(input.url_or_note);
  if (figma) {
    if (!process.env.FIGMA_ACCESS_TOKEN) {
      return `Attached URL. Note: FIGMA_ACCESS_TOKEN is not set, so I couldn't fetch frames from this file — ACs won't be able to reference specific frame names. Set the env var to enable that.`;
    }
    try {
      const tree = await getFigmaTree(figma.fileId);
      const catalog = buildFrameCatalog(figma.fileId, tree.name, tree.nodes, figma.nodeId);
      const frames: FigmaFrameRef[] = catalog.map((c) => ({
        file_id: c.file_id,
        node_id: c.node_id,
        name: c.name,
        type: c.type,
        path: c.path,
      }));
      session.figma_frames = [...(session.figma_frames ?? []), ...frames];
      const scope = figma.nodeId ? ` (scoped to node ${figma.nodeId} and its descendants)` : "";
      return `Attached Figma file "${tree.name}"${scope}. Loaded ${frames.length} frame(s) — ACs can now reference them by name.`;
    } catch (err) {
      return `Attached URL, but couldn't fetch the Figma file tree: ${err instanceof Error ? err.message : String(err)}. ACs will still reference the URL but not specific frames.`;
    }
  }

  return `Attached. Session now has ${session.attached_urls.length} context item(s).`;
}

async function generateTicketsTool(session: Session, config: ConduitConfig): Promise<string> {
  if (!session.spec_text) return "No spec loaded — call ingest_spec first.";
  const spec = synthSpec(session);
  let context = `Spec file: ${spec.file}\n\n${spec.raw}`;
  if (session.attached_urls.length > 0) {
    context += `\n\nAdditional context attached by the PM:\n` + session.attached_urls.map((u) => `- ${u}`).join("\n");
  }
  if (session.figma_frames && session.figma_frames.length > 0) {
    context +=
      `\n\nAVAILABLE FIGMA FRAMES — the PM has attached one or more Figma files. These are the ONLY frames that exist:\n` +
      session.figma_frames.map((f) => `- "${f.path}" (${f.type}, node ${f.node_id})`).join("\n") +
      `\n\nFIGMA-FRAME RULES (strict):\n` +
      `1. If you reference a Figma frame in a ticket title, description, or AC, the frame name must match a name from the list above CHARACTER-FOR-CHARACTER. Don't paraphrase, translate, pluralize, shorten, or "tidy up" the name. Copy it verbatim.\n` +
      `2. Don't invent frames that aren't in the list. If you find yourself wanting to reference "the Loading state" or "the Confirmation screen" and no such name appears in the list, the frame doesn't exist — describe the behavior without a frame reference, or note "(no design yet)".\n` +
      `3. Don't reference a frame just because it sounds related. Only reference a frame when an AC describes behavior actually visible on that specific frame.\n` +
      `4. When you do reference a frame, use the full path (e.g. 'the "Future phases > Unavailable" frame'), not just the last segment. This disambiguates frames that share a name.\n` +
      `5. Before finalizing each AC that mentions a frame, mentally check: does the exact string I'm about to emit appear in the list above? If no — remove the frame reference.`;
  }
  if (session.tone) {
    context = `TONE OVERRIDE: ${session.tone}\n\n${context}`;
  }
  const tickets = await generateTickets(context, config);

  // Backstop: scan generated tickets for frame-name references the model
  // invented (i.e. not in the catalog). Strip the invented refs and log a
  // warning so prompt hallucination is observable even if the prompt rule
  // is ignored. Only runs when the session actually loaded frames.
  if (session.figma_frames && session.figma_frames.length > 0) {
    const validNames = new Set(session.figma_frames.map((f) => f.name));
    const validPaths = new Set(session.figma_frames.map((f) => f.path));
    const violations: string[] = [];
    for (const t of tickets) {
      const cleaned = stripInventedFrameRefs(t.description, validNames, validPaths, violations, `${t.title} (description)`);
      t.description = cleaned;
      t.acceptance_criteria = t.acceptance_criteria.map((ac) =>
        stripInventedFrameRefs(ac, validNames, validPaths, violations, `${t.title} (ac)`)
      );
    }
    if (violations.length > 0) {
      console.warn(`[slack/tools] Stripped ${violations.length} invented Figma frame ref(s) from generated tickets:\n  ${violations.join("\n  ")}`);
    }
  }

  session.draft_tickets = tickets;
  const epics = tickets.filter((t) => t.type === "epic");
  const stories = tickets.filter((t) => t.type === "story");
  const summary = epics.map((e) => {
    const kids = stories.filter((s) => s.parent_title === e.title);
    return `📦 ${e.title}\n` + kids.map((s) => `   📋 ${s.title}`).join("\n");
  }).join("\n\n");
  return `Drafted ${tickets.length} tickets (${epics.length} epics, ${stories.length} stories):\n\n${summary}`;
}

function updateBreakdown(input: { edits: string }, session: Session): string {
  if (!session.draft_tickets) return "No draft tickets to edit — call generate_tickets first.";
  let parsed: { remove?: string[]; edit?: Array<{ title: string; new_title?: string; new_description?: string }>; add?: Array<{ title: string; description: string; parent_title?: string }> };
  try { parsed = JSON.parse(input.edits); }
  catch { return `edits must be valid JSON. Got: ${input.edits.slice(0, 200)}`; }

  let removed = 0, edited = 0, added = 0;
  if (parsed.remove) {
    const toRemove = new Set(parsed.remove);
    const before = session.draft_tickets.length;
    session.draft_tickets = session.draft_tickets.filter((t) => !toRemove.has(t.title));
    removed = before - session.draft_tickets.length;
  }
  if (parsed.edit) {
    for (const e of parsed.edit) {
      const t = session.draft_tickets.find((t) => t.title === e.title);
      if (!t) continue;
      if (e.new_title) t.title = e.new_title;
      if (e.new_description) t.description = e.new_description;
      edited++;
    }
  }
  if (parsed.add) {
    for (const a of parsed.add) {
      session.draft_tickets.push({
        type: a.parent_title ? "story" : "epic",
        title: a.title,
        description: a.description,
        acceptance_criteria: [],
        parent_title: a.parent_title,
        labels: [],
        spec_ref: { file: session.spec_file_path ?? "session.md", section_title: "(manually added)", line: 0 },
      });
      added++;
    }
  }
  return `Applied edits: removed ${removed}, edited ${edited}, added ${added}. Draft now has ${session.draft_tickets.length} tickets.`;
}

async function pushTickets(session: Session, config: ConduitConfig): Promise<string> {
  if (!session.draft_tickets || session.draft_tickets.length === 0) return "No draft tickets to push.";
  const provider = getProvider(config.tickets.provider);
  const tickets = session.draft_tickets;
  const epics = tickets.filter((t) => t.type === "epic");

  const epicProject = new Map<string, string>();
  for (const epic of epics) {
    const project = session.destination ?? routeFor({
      spec_file: epic.spec_ref.file,
      section_title: epic.spec_ref.section_title,
      ticket_labels: config.tickets.labels,
    }, config);
    epicProject.set(epic.title, project);
  }

  const projectCache = new Map<string, { projectId: string; labelIds: string[] }>();
  const usedProjects = new Set<string>(epicProject.values());
  for (const orphan of tickets.filter((t) => t.type === "story" && (!t.parent_title || !epicProject.has(t.parent_title)))) {
    usedProjects.add(session.destination ?? routeFor({
      spec_file: orphan.spec_ref.file,
      section_title: orphan.spec_ref.section_title,
      ticket_labels: config.tickets.labels,
    }, config));
  }
  for (const project of usedProjects) {
    const projectId = await provider.resolveProject(project);
    const labelIds: string[] = [];
    for (const label of config.tickets.labels) labelIds.push(await provider.ensureLabel(projectId, label));
    projectCache.set(project, { projectId, labelIds });
  }

  const state = loadState(config.sync.state_file);
  const createdMap = new Map<string, { id: string; key: string; project: string }>();
  const links: string[] = [];

  for (const ticket of epics) {
    const project = epicProject.get(ticket.title)!;
    const { projectId, labelIds } = projectCache.get(project)!;
    const result = await provider.createTicket(projectId, {
      title: ticket.title,
      description: formatDescription(ticket),
      labels: labelIds,
      type: "epic",
    });
    createdMap.set(ticket.title, { id: result.id, key: result.key, project });
    addMapping(state, { spec_file: ticket.spec_ref.file, spec_section: ticket.spec_ref.section_title, spec_hash: hashContent(ticket.description), ticket_id: result.key, ticket_provider: config.tickets.provider, ticket_project: project, ticket_type: "epic", last_synced: new Date().toISOString() });
    links.push(`[${result.key}] ${ticket.title}`);
  }
  for (const ticket of tickets.filter((t) => t.type !== "epic")) {
    const parent = ticket.parent_title ? createdMap.get(ticket.parent_title) : undefined;
    const project = parent?.project ?? session.destination ?? routeFor({ spec_file: ticket.spec_ref.file, section_title: ticket.spec_ref.section_title, ticket_labels: config.tickets.labels }, config);
    const { projectId, labelIds } = projectCache.get(project)!;
    const result = await provider.createTicket(projectId, {
      title: ticket.title,
      description: formatDescription(ticket),
      parentId: parent?.id,
      labels: labelIds,
      type: ticket.type,
    });
    createdMap.set(ticket.title, { id: result.id, key: result.key, project });
    addMapping(state, { spec_file: ticket.spec_ref.file, spec_section: ticket.spec_ref.section_title, spec_hash: hashContent(ticket.description), ticket_id: result.key, ticket_provider: config.tickets.provider, ticket_project: project, ticket_type: ticket.type, parent_ticket_id: parent?.id, last_synced: new Date().toISOString() });
    links.push(`[${result.key}] ${ticket.title}`);
  }
  saveState(config.sync.state_file, state);
  session.pushed_ticket_ids = [...createdMap.values()].map((v) => v.key);
  // Stay "active" — the PM may want to reorganize, add follow-ups, or move
  // tickets under a new epic in the same conversation. Use a separate close
  // action (future) to mark a session as done.
  return `Pushed ${tickets.length} tickets to ${provider.name}:\n` + links.join("\n");
}

async function saveSpecToRepo(
  input: { path?: string; commit_message?: string },
  session: Session,
  config: ConduitConfig
): Promise<string> {
  if (!session.spec_text) return "No spec loaded — call ingest_spec first.";

  const token = process.env.GITHUB_TOKEN;
  const repoEnv = process.env.CONDUIT_GITHUB_REPO;
  if (!token) return "GITHUB_TOKEN is not set — can't commit to the repo. Set it in .env and retry.";
  if (!repoEnv || !repoEnv.includes("/")) return "CONDUIT_GITHUB_REPO is not set (expected 'owner/name'). Set it in .env and retry.";
  const [owner, repo] = repoEnv.split("/");

  // Derive a path from the spec H1 if none provided.
  const targetPath = input.path ?? deriveSpecPath(session.spec_text);
  if (!targetPath.startsWith("specs/")) {
    return `Path must start with 'specs/'. Got: ${targetPath}`;
  }

  const octokit = new Octokit({ auth: token });

  // Check if the file already exists so we can decide create vs update.
  let existingSha: string | undefined;
  try {
    const existing = await octokit.repos.getContent({ owner, repo, path: targetPath });
    if (!Array.isArray(existing.data) && "sha" in existing.data) existingSha = existing.data.sha;
  } catch (err) {
    // 404 = create new. Other errors propagate.
    if ((err as { status?: number }).status !== 404) {
      return `Could not check existing file at ${targetPath}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const commitMessage = input.commit_message ?? "docs: add spec via Slack session";
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: targetPath,
    message: commitMessage,
    content: Buffer.from(session.spec_text, "utf-8").toString("base64"),
    sha: existingSha,
  });

  // Update the session and any already-pushed tickets' state.json entries so
  // reverse-sync (v0.2) finds the spec file when webhooks fire on those tickets.
  session.spec_file_path = targetPath;
  const state = loadState(config.sync.state_file);
  let migrated = 0;
  for (const m of state.mappings) {
    if (m.spec_file === "(slack session)" || m.spec_file.startsWith("session://")) {
      m.spec_file = targetPath.replace(/^specs\//, "");
      migrated++;
    }
  }
  saveState(config.sync.state_file, state);

  const created = existingSha ? "Updated" : "Created";
  return `${created} ${owner}/${repo}:${targetPath}. ${migrated > 0 ? `Migrated ${migrated} state.json mapping(s) to point at the new path — reverse-sync is now armed for those tickets.` : "No prior mappings needed updating."}`;
}

function deriveSpecPath(specText: string): string {
  const h1 = specText.match(/^#\s+(.+)$/m);
  const title = h1 ? h1[1].trim() : "untitled-spec";
  const slug = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `specs/${slug || "untitled-spec"}.md`;
}

function stripInventedFrameRefs(
  text: string,
  validNames: Set<string>,
  validPaths: Set<string>,
  violations: string[],
  context: string
): string {
  // Match the two patterns the prompt teaches the model to produce:
  //   the "X" frame
  //   the 'X' frame
  // For each match, the captured X must equal a known frame name or path.
  return text.replace(/the\s+["“']([^"”']+)["”']\s+frame/gi, (match, ref) => {
    if (validNames.has(ref) || validPaths.has(ref)) return match;
    violations.push(`${context}: invented frame "${ref}"`);
    return "the appropriate screen";
  });
}

async function createJiraTicket(
  input: { title: string; description: string; type: "epic" | "story"; project_key?: string; parent_key?: string },
  session: Session,
  config: ConduitConfig
): Promise<string> {
  if (config.tickets.provider !== "jira") return `create_jira_ticket only supports Jira (current provider: ${config.tickets.provider}).`;
  const provider = getProvider("jira");
  const project = input.project_key ?? session.destination ?? config.tickets.project;
  const projectId = await provider.resolveProject(project);
  const labelIds: string[] = [];
  for (const label of config.tickets.labels) labelIds.push(await provider.ensureLabel(projectId, label));
  let parentId: string | undefined;
  if (input.parent_key) {
    // Look up the parent in state.json to get its internal id; fall back to passing the key directly.
    const state = loadState(config.sync.state_file);
    const mapping = state.mappings.find((m) => m.ticket_id === input.parent_key);
    parentId = mapping?.parent_ticket_id ?? undefined;
    // Note: Jira's create endpoint accepts parent by key directly via fields.parent.key —
    // but our provider abstraction passes parentId. For epics+stories pushed by conduit,
    // we resolved IDs at push time; reuse them when available.
  }
  const result = await provider.createTicket(projectId, {
    title: input.title,
    description: input.description,
    labels: labelIds,
    type: input.type,
    parentId,
  });

  const state = loadState(config.sync.state_file);
  addMapping(state, {
    spec_file: session.spec_file_path ?? "(slack session)",
    spec_section: input.title,
    spec_hash: hashContent(input.description),
    ticket_id: result.key,
    ticket_provider: "jira",
    ticket_project: project,
    ticket_type: input.type,
    parent_ticket_id: parentId,
    last_synced: new Date().toISOString(),
  });
  saveState(config.sync.state_file, state);

  return `Created ${input.type} ${result.key} in ${project}: "${input.title}"`;
}

async function changeJiraParent(
  input: { ticket_keys: string[]; new_parent_key: string },
  config: ConduitConfig
): Promise<string> {
  if (config.tickets.provider !== "jira") return `change_jira_parent only supports Jira (current provider: ${config.tickets.provider}).`;
  const provider = getProvider("jira");
  const results: string[] = [];
  const errors: string[] = [];
  for (const key of input.ticket_keys) {
    try {
      await provider.updateTicket({ id: key, parentKey: input.new_parent_key });
      results.push(key);
    } catch (err) {
      errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Reflect the new parent in state.json so reverse-direction sync stays consistent.
  const state = loadState(config.sync.state_file);
  const newParentMapping = state.mappings.find((m) => m.ticket_id === input.new_parent_key);
  const newParentInternalId = newParentMapping ? state.mappings.find((m) => m.ticket_id === input.new_parent_key)?.parent_ticket_id : undefined;
  for (const key of results) {
    const m = state.mappings.find((mm) => mm.ticket_id === key);
    if (m) m.parent_ticket_id = input.new_parent_key ? (newParentInternalId ?? input.new_parent_key) : undefined;
  }
  saveState(config.sync.state_file, state);

  const action = input.new_parent_key ? `reparented under ${input.new_parent_key}` : "detached from any epic";
  const ok = results.length ? `${results.length} ticket(s) ${action}: ${results.join(", ")}.` : "";
  const fail = errors.length ? ` Errors: ${errors.join("; ")}.` : "";
  return (ok + fail).trim() || "No tickets specified.";
}

function synthSpec(session: Session): { file: string; sections: ReturnType<typeof parseSpec>["sections"]; raw: string } {
  if (session.spec_file_path && existsSync(session.spec_file_path)) {
    return parseSpec(session.spec_file_path);
  }
  // Pasted spec — write to a temp anchor name so the parser can populate file refs
  const fakePath = `session://${session.thread_ts}`;
  const lines = (session.spec_text ?? "").split("\n");
  const sections: ReturnType<typeof parseSpec>["sections"] = [];
  let current: ReturnType<typeof parseSpec>["sections"][number] | null = null;
  let body: string[] = [];
  lines.forEach((line, i) => {
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      if (current) { current.body = body.join("\n").trim(); sections.push(current); }
      current = { level: match[1].length, title: match[2].trim(), body: "", tasks: [], file: fakePath, line: i + 1 };
      body = [];
    } else {
      body.push(line);
    }
  });
  if (current !== null) {
    const last = current as ReturnType<typeof parseSpec>["sections"][number];
    last.body = body.join("\n").trim();
    sections.push(last);
  }
  return { file: fakePath, sections, raw: session.spec_text ?? "" };
}

function formatDescription(ticket: GeneratedTicket): string {
  let desc = ticket.description + "\n";
  if (ticket.acceptance_criteria.length > 0) {
    desc += "\n## Acceptance Criteria\n";
    for (const ac of ticket.acceptance_criteria) desc += `- ${ac}\n`;
  }
  desc += `\n---\n_Generated by conduit (Slack session) from \`${ticket.spec_ref.file}\` → "${ticket.spec_ref.section_title}"_`;
  return desc;
}
