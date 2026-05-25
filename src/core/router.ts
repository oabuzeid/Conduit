import { minimatch } from "minimatch";
import type { ConduitConfig, Route } from "./config.js";

export interface RouteInput {
  spec_file: string;
  section_title: string;
  ticket_labels: string[];
}

export function routeFor(input: RouteInput, config: ConduitConfig): string {
  const route = config.tickets.routes.find((r) => matches(r, input));
  if (route) return route.project;
  if (!config.tickets.project) {
    throw new Error(
      "conduit.yaml: no default tickets.project set and no route matched. " +
        "Set tickets.project as the catch-all, or add a route that matches every spec."
    );
  }
  return config.tickets.project;
}

function matches(route: Route, input: RouteInput): boolean {
  const m = route.match;
  if (m.section_contains && !input.section_title.toLowerCase().includes(m.section_contains.toLowerCase())) {
    return false;
  }
  if (m.file_glob && !minimatch(input.spec_file, m.file_glob)) {
    return false;
  }
  if (m.ticket_labels_contain) {
    const needle = m.ticket_labels_contain.toLowerCase();
    if (!input.ticket_labels.some((l) => l.toLowerCase().includes(needle))) {
      return false;
    }
  }
  return Boolean(m.section_contains || m.file_glob || m.ticket_labels_contain);
}
