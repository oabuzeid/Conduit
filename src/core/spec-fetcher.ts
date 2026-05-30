// Fetches spec content from external URLs. v0.3 supports public Google Docs;
// Confluence and private Google Docs (OAuth) are deferred.

export interface FetchResult {
  source_url: string;
  source_kind: "google_doc";
  content: string;
}

export async function fetchSpecFromUrl(url: string): Promise<FetchResult> {
  if (url.includes("docs.google.com/document/")) {
    return fetchGoogleDoc(url);
  }
  throw new Error(
    `Unsupported URL: ${url}. v0.3 supports public Google Docs (docs.google.com/document/*). ` +
      `Confluence and private docs are not yet implemented — paste the content directly, or share the doc as "anyone with the link can view."`
  );
}

async function fetchGoogleDoc(url: string): Promise<FetchResult> {
  const idMatch = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) throw new Error(`Could not extract document ID from Google Doc URL: ${url}`);
  const docId = idMatch[1];
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=md`;

  const res = await fetch(exportUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Google Docs fetch failed: ${res.status} ${res.statusText}. The doc may be private — share it as "anyone with the link can view."`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();

  // Google returns an HTML login page (not the doc) when the doc is private and the user isn't logged in.
  // Detect that and fail loudly instead of feeding HTML into the spec parser.
  if (contentType.includes("text/html") || body.trim().startsWith("<!DOCTYPE")) {
    throw new Error(
      `Google Docs returned HTML instead of markdown. The doc is likely private. ` +
        `Open the doc → Share → "Anyone with the link can view" → retry.`
    );
  }

  return { source_url: url, source_kind: "google_doc", content: body };
}
