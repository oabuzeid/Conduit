import type { ConduitConfig } from "../core/config.js";
import { propagateMerge } from "../core/merge-propagator.js";

interface GitHubPRPayload {
  action?: string;
  pull_request?: {
    number: number;
    merged?: boolean;
  };
}

export async function handleGitHubWebhook(
  eventType: string | undefined,
  payload: GitHubPRPayload,
  _config: ConduitConfig
): Promise<void> {
  if (eventType !== "pull_request") {
    console.log(`[github] ignoring event: ${eventType}`);
    return;
  }
  if (payload.action !== "closed" || !payload.pull_request?.merged) {
    console.log(`[github] ignoring PR ${payload.pull_request?.number} action: ${payload.action} (merged=${payload.pull_request?.merged})`);
    return;
  }
  const prNumber = payload.pull_request.number;
  console.log(`[github] PR #${prNumber} merged — propagating downstream`);
  const result = await propagateMerge(prNumber);
  if (result.propagated_to.length) {
    console.log(`[github] PR #${prNumber}: propagated to ${result.propagated_to.join(", ")}`);
  } else {
    console.log(`[github] PR #${prNumber}: nothing to propagate (${result.skipped.join("; ") || "no pending record"})`);
  }
}
