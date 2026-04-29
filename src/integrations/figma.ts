/**
 * Figma integration for Specbot.
 *
 * Reads the Figma file tree (for audit) and posts comments on
 * specific frames or the file root when specs change.
 *
 * Requires FIGMA_ACCESS_TOKEN environment variable.
 */

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  characters?: string; // text content for TEXT nodes
}

export interface FigmaComment {
  frameId?: string; // node ID to attach comment to, or file-level if omitted
  message: string;
}

function getToken(): string {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "FIGMA_ACCESS_TOKEN not set. Get one at: https://www.figma.com/developers/api#access-tokens"
    );
  }
  return token;
}

async function figmaFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`https://api.figma.com/v1${path}`, {
    ...options,
    headers: {
      "X-Figma-Token": getToken(),
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma API error: ${res.status} ${res.statusText}\n${body}`);
  }

  return (await res.json()) as T;
}

/**
 * Fetch the full node tree of a Figma file.
 */
export async function getFigmaTree(
  fileId: string
): Promise<{ name: string; nodes: FigmaNode[] }> {
  const data = await figmaFetch<{
    name: string;
    document: { children: FigmaNode[] };
  }>(`/files/${fileId}`);

  return { name: data.name, nodes: data.document.children };
}

/**
 * Produce a text description of the Figma tree for the AI engine.
 */
export function figmaTreeToPromptContext(
  fileName: string,
  nodes: FigmaNode[],
  depth = 0
): string {
  const indent = "  ".repeat(depth);
  let out = depth === 0 ? `Figma File: ${fileName}\n\n` : "";

  for (const node of nodes) {
    const label =
      node.type === "TEXT" && node.characters
        ? `${node.type}: "${node.characters}"`
        : `${node.type}: ${node.name}`;
    out += `${indent}- [${node.id}] ${label}\n`;

    if (node.children && depth < 4) {
      out += figmaTreeToPromptContext(fileName, node.children, depth + 1);
    }
  }
  return out;
}

/**
 * Find Figma frames whose names match a search term (case-insensitive).
 * Useful for mapping spec sections to Figma frames.
 */
export function findFramesByName(
  nodes: FigmaNode[],
  search: string
): FigmaNode[] {
  const results: FigmaNode[] = [];
  const lower = search.toLowerCase();

  function walk(node: FigmaNode) {
    if (
      (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "SECTION") &&
      node.name.toLowerCase().includes(lower)
    ) {
      results.push(node);
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }

  for (const node of nodes) walk(node);
  return results;
}

/**
 * Post a comment on a Figma file, optionally pinned to a specific node.
 */
export async function postComment(
  fileId: string,
  comment: FigmaComment
): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    message: comment.message,
  };

  // Pin to a specific frame if provided
  if (comment.frameId) {
    body.client_meta = {
      node_id: comment.frameId,
      node_offset: { x: 0, y: 0 },
    };
  }

  const data = await figmaFetch<{ id: string }>(
    `/files/${fileId}/comments`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );

  return data;
}

/**
 * Post multiple comments for a set of spec changes.
 * Tries to match spec section titles to Figma frame names.
 * Falls back to file-level comment if no match.
 */
export async function postSpecChangeComments(
  fileId: string,
  nodes: FigmaNode[],
  changes: { sectionTitle: string; summary: string }[]
): Promise<{ posted: number; matched: number }> {
  let posted = 0;
  let matched = 0;

  for (const change of changes) {
    const frames = findFramesByName(nodes, change.sectionTitle);
    const message = `📋 Spec updated: ${change.sectionTitle}\n\n${change.summary}\n\n— Posted by specbot`;

    if (frames.length > 0) {
      // Comment on the first matching frame
      await postComment(fileId, {
        frameId: frames[0].id,
        message,
      });
      matched++;
    } else {
      // File-level comment
      await postComment(fileId, { message });
    }
    posted++;
  }

  return { posted, matched };
}
