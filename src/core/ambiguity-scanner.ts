import Anthropic from "@anthropic-ai/sdk";
import type { ConduitConfig } from "./config.js";
import type { ParsedSpec } from "./spec-parser.js";
import { captured } from "./capture.js";

export type AmbiguityKind =
  | "vague_verb"
  | "undefined_term"
  | "missing_edge_case"
  | "conflict"
  | "open_question_in_build_text";

export interface AmbiguityFinding {
  kind: AmbiguityKind;
  spec_file: string;
  section: string;
  excerpt: string;
  reason: string;
  suggested_fix: string;
  severity: "high" | "medium" | "low";
}

const client = new Anthropic();

export async function scanSpecForAmbiguity(
  spec: ParsedSpec,
  config: ConduitConfig
): Promise<AmbiguityFinding[]> {
  const prompt = `You are reviewing a product spec for ambiguities BEFORE tickets are generated from it. Flag passages a PM would want to tighten now, so generated tickets don't carry the ambiguity downstream.

WHAT TO FLAG:
- "vague_verb": words like "automatically", "smoothly", "seamlessly", "intelligently", "handle gracefully" — verbs that hide behavior. Flag with a specific question the spec doesn't answer.
- "undefined_term": jargon, product names, or technical terms used without definition the first time. Only flag if a new reader couldn't reasonably infer the meaning from context.
- "missing_edge_case": a flow describes the happy path but doesn't cover an obvious failure mode, empty state, permission denial, or boundary. Be specific about which edge case is missing.
- "conflict": two passages in different sections that contradict each other, OR a passage that contradicts an explicit constraint stated elsewhere in the spec. Quote both sides.
- "open_question_in_build_text": text that should be in a "Decisions Needed" section instead appears inline in a build-intent passage (e.g. a question mark, a TBD, a parenthetical "(? not sure)" embedded in what reads as a requirement).

Severity:
- "high": ambiguity would generate incorrect or contradictory tickets.
- "medium": ambiguity would generate vague AC that engineers can't test.
- "low": ambiguity is a clarity nit; tickets would still be usable.

Be selective — flag at most 8 findings. Quality over quantity. Don't flag conventional-but-vague phrasing if the surrounding context makes the meaning obvious.

Respond with JSON only — no markdown, no preamble:
{
  "findings": [
    {
      "kind": "vague_verb" | "undefined_term" | "missing_edge_case" | "conflict" | "open_question_in_build_text",
      "section": "<section title>",
      "excerpt": "<verbatim quote, ≤120 chars>",
      "reason": "<1 sentence: what's ambiguous>",
      "suggested_fix": "<1 sentence: how to tighten>",
      "severity": "high" | "medium" | "low"
    }
  ]
}

SPEC FILE: ${spec.file}

CONTENT:
${spec.raw}`;

  const result = await captured(
    "analyze_reverse_diff",
    { prompt, spec_chars: spec.raw.length, op: "ambiguity_scan" },
    { model: config.ai.model },
    async () => {
      const response = await client.messages.create({
        model: config.ai.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });
      const t = response.content[0].type === "text" ? response.content[0].text : "";
      return JSON.parse(t.replace(/```json|```/g, "").trim()) as { findings: Omit<AmbiguityFinding, "spec_file">[] };
    }
  );

  return result.findings.map((f) => ({ ...f, spec_file: spec.file }));
}
