import type { TicketProvider } from "./types.js";
import { LinearProvider } from "./linear-provider.js";
import { JiraProvider } from "./jira-provider.js";

const providers: Record<string, () => TicketProvider> = {
  linear: () => new LinearProvider(),
  jira: () => new JiraProvider(),
};

/**
 * Get a ticket provider by name.
 * Throws if the provider isn't registered.
 *
 * To add a new provider:
 *   1. Create a class implementing TicketProvider
 *   2. Add it to the `providers` map above
 */
export function getProvider(name: string): TicketProvider {
  const factory = providers[name.toLowerCase()];
  if (!factory) {
    const available = Object.keys(providers).join(", ");
    throw new Error(
      `Unknown ticket provider "${name}". Available: ${available}`
    );
  }
  return factory();
}
