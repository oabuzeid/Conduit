import Anthropic from "@anthropic-ai/sdk";
import type { ConduitConfig } from "./config.js";
import type { ParsedSpec } from "./spec-parser.js";
import { captured } from "./capture.js";

export interface SpecMapping {
  file: string;
  section: string;
  content: string;
  confidence: "high" | "medium" | "low";
}

const client = new Anthropic();

export async function mapToSpecSection(
  text: string,
  specs: ParsedSpec[],
  config: ConduitConfig
): Promise<SpecMapping | null> {
  if (specs.length === 0) return null;
  const catalog = specs
    .flatMap((s) =>
      s.sections.map((sec) => ({
        file: s.file,
        title: sec.title,
        body: sec.body,
      }))
    )
    .filter((s) => s.title);
  if (catalog.length === 0) return null;

  const sectionList = catalog
    .map((s, i) => `${i + 1}. [${s.file}] ${s.title}\n   ${s.body.slice(0, 800).replace(/\s+/g, " ").trim()}`)
    .join("\n\n");

  const prompt = `You are mapping an external artifact (a ticket title/description, or a Figma frame name) to the best-matching spec section.

CANDIDATE SECTIONS:
${sectionList}

ARTIFACT TO MAP:
${text}

Return JSON only — no markdown, no preamble:
{
  "match_index": <1-based index of the matching section, or 0 if no section is a good match>,
  "confidence": "high" | "medium" | "low"
}

Guidance:
- "high": the artifact is clearly about the same thing as one specific section (shared subject, behavior, or screen).
- "medium": the artifact relates to the section but introduces additional scope.
- "low": the artifact only loosely connects (broad theme overlap, no specific match).
- 0: no section is a reasonable home for this artifact.`;

  const result = await captured(
    "analyze_reverse_diff",
    { prompt, text_chars: text.length, candidate_count: catalog.length },
    { model: config.ai.model, op: "spec_mapping" },
    async () => {
      const response = await client.messages.create({
        model: config.ai.model,
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      });
      const t = response.content[0].type === "text" ? response.content[0].text : "";
      return JSON.parse(t.replace(/```json|```/g, "").trim()) as { match_index: number; confidence: "high" | "medium" | "low" };
    }
  );

  if (!result.match_index || result.match_index < 1 || result.match_index > catalog.length) return null;
  const picked = catalog[result.match_index - 1];
  return { file: picked.file, section: picked.title, content: picked.body, confidence: result.confidence };
}
