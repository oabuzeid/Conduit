import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import { readFileSync } from "fs";
import type { ConduitConfig } from "./config.js";
import type { AgentDecision, TicketChangeEvent, DesignChangeEvent } from "./events.js";
import { captured } from "./capture.js";
import { recordPendingPR } from "./pending-prs.js";

export interface SpecPRResult {
  pr_url: string;
  pr_number: number;
  branch_name: string;
}

export interface OpenSpecPRInput {
  decision: AgentDecision & { pr_payload: NonNullable<AgentDecision["pr_payload"]> };
  triggering_event: TicketChangeEvent | DesignChangeEvent;
  spec_file_path: string;
  repo: { owner: string; name: string; base_branch?: string };
}

const anthropic = new Anthropic();

export async function openSpecPR(input: OpenSpecPRInput, config: ConduitConfig): Promise<SpecPRResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN env var is required to open spec PRs");

  const currentContent = readFileSync(input.spec_file_path, "utf-8");
  const { newContent, prBody } = await draftSpecEdit(currentContent, input, config);

  const octokit = new Octokit({ auth: token });
  const base = input.repo.base_branch ?? "main";
  const branch = input.decision.pr_payload.branch_name;

  const baseRef = await octokit.git.getRef({
    owner: input.repo.owner,
    repo: input.repo.name,
    ref: `heads/${base}`,
  });
  await octokit.git.createRef({
    owner: input.repo.owner,
    repo: input.repo.name,
    ref: `refs/heads/${branch}`,
    sha: baseRef.data.object.sha,
  });

  const existingFile = await octokit.repos.getContent({
    owner: input.repo.owner,
    repo: input.repo.name,
    path: input.decision.pr_payload.target_spec_file,
    ref: branch,
  });
  const fileSha = Array.isArray(existingFile.data) ? undefined : (existingFile.data as { sha: string }).sha;

  await octokit.repos.createOrUpdateFileContents({
    owner: input.repo.owner,
    repo: input.repo.name,
    path: input.decision.pr_payload.target_spec_file,
    message: `conduit: ${input.decision.pr_payload.edit_summary}`,
    content: Buffer.from(newContent, "utf-8").toString("base64"),
    branch,
    sha: fileSha,
  });

  const pr = await octokit.pulls.create({
    owner: input.repo.owner,
    repo: input.repo.name,
    title: `[conduit] ${input.decision.pr_payload.edit_summary}`,
    head: branch,
    base,
    body: prBody,
  });

  recordPendingPR({
    pr_number: pr.data.number,
    repo: { owner: input.repo.owner, name: input.repo.name },
    triggering_event: input.triggering_event,
    target_spec_file: input.decision.pr_payload.target_spec_file,
    branch_name: branch,
    opened_at: new Date().toISOString(),
  });

  return { pr_url: pr.data.html_url, pr_number: pr.data.number, branch_name: branch };
}

export async function draftSpecEdit(
  currentContent: string,
  input: OpenSpecPRInput,
  config: ConduitConfig
): Promise<{ newContent: string; prBody: string }> {
  const kindHint =
    "change_kind" in input.triggering_event
      ? input.triggering_event.change_kind === "created"
        ? "This is a NEW TICKET being absorbed into the spec — add the relevant scope (typically as a new bullet or AC under the mapped section, or as a new subsection if the mapping is loose)."
        : input.triggering_event.change_kind === "deleted"
          ? "A TICKET WAS DELETED — remove the corresponding scope from the spec section. Be conservative: only remove the part that was uniquely tied to this ticket."
          : "An EDIT — apply the smallest possible region change."
      : "An EDIT — apply the smallest possible region change.";

  const prompt = `You are editing a product spec to absorb a change that came from a ticket or design tool.

${kindHint}

Apply the change described below to the spec. Return JSON:
{
  "new_spec_content": "<the full updated spec file content>",
  "pr_body": "<the PR description>"
}

Rules:
- Preserve every line of the spec that does not need to change. Do not rewrite the spec wholesale.
- Edit the smallest possible region. If only one paragraph or AC list needs updating, only update that.
- Keep markdown headings and structure intact.

PR body must follow this structure:
## Source
<which ticket or Figma frame triggered this, with id and title>

## What changed externally
<2-3 sentences from the triggering event's narrative_summary>

## Spec edit
<bullet list of the specific edits being made>

## Downstream propagation after merge
<what conduit will update in tickets / Figma comments once this PR merges>

EDIT SUMMARY (the agent's intent): ${input.decision.pr_payload.edit_summary}

TRIGGERING EVENT:
${JSON.stringify(input.triggering_event, null, 2)}

CURRENT SPEC (${input.spec_file_path}):
${currentContent}

Respond ONLY with JSON. No markdown fences, no preamble.`;

  return captured(
    "draft_spec_edit",
    { prompt, spec_chars: currentContent.length },
    { model: config.ai.model },
    async () => {
      const response = await anthropic.messages.create({
        model: config.ai.model,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const cleaned = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned) as { new_spec_content: string; pr_body: string };
      return { newContent: parsed.new_spec_content, prBody: parsed.pr_body };
    }
  );
}
