import { writeFileSync, existsSync, mkdirSync } from "fs";
import chalk from "chalk";

const EXAMPLE_CONFIG = `# conduit.yaml
specs:
  - "specs/**/*.md"

tickets:
  provider: linear          # linear | jira
  project: "ENG"            # default project — every ticket goes here unless a route below matches
  # routes:                 # optional — split work across projects (iOS/Android/backend, etc)
  #   - match: { section_contains: "iOS" }
  #     project: "IOS"
  #   - match: { file_glob: "specs/payments/*.md" }
  #     project: "PAY"
  #   - match: { ticket_labels_contain: "backend" }
  #     project: "BACK"
  mapping:
    epic: h1
    story: h2
  labels:
    - "conduit-managed"

# design:
#   provider: figma
#   file_id: "your-figma-file-id"
#   significant_change_threshold:
#     min_frames_added: 1          # top-level frames added before a webhook event is classified
#     min_frames_removed: 1        # top-level frames removed before a webhook event is classified
#     min_text_chars_changed: 50   # roughly one CTA or one sentence; below this is usually a typo or spacing tweak
#     track_top_level_only: true   # ignore changes inside nested components (icons, padding, etc)

ai:
  model: "claude-sonnet-4-20250514"
  breakdown:
    mode: "by_section"          # by_section | by_layer | by_component | custom
    # custom_instructions: ""   # required only when mode is "custom"; tells Claude how to group stories
  ac_format:
    format: "given_when_then"   # given_when_then | bullets | numbered
    include_background: false   # if true, AC may restate story context (e.g. "Given a host has completed check-in...")
    include_figma_links: false  # if true, AC references Figma frame names when relevant (forward-looking; generate ingests Figma in v0.2)

sync:
  auto_update: false
  detect_drift: true
  state_file: ".conduit/state.json"
`;

const EXAMPLE_SPEC = `# User Onboarding Flow

A guided onboarding experience for new users to set up their account and preferences.

## Account Setup

Users complete a 3-step form: name, email verification, and password creation.

- [ ] Implement name input with validation
- [ ] Build email verification flow (send code, verify)
- [ ] Add password strength meter

## Profile Preferences

Users select their role and notification preferences.

- [ ] Role selection dropdown (Admin, Member, Viewer)
- [ ] Notification toggles (email, push, SMS)
- [ ] Timezone auto-detection with manual override

## Welcome Tour

An interactive walkthrough highlighting key product features.

- [ ] Build tooltip-based tour overlay
- [ ] Add skip/dismiss functionality
- [ ] Track tour completion analytics
`;

export function runInit(): void {
  if (existsSync("conduit.yaml")) {
    console.log(chalk.yellow("conduit.yaml already exists — skipping."));
  } else {
    writeFileSync("conduit.yaml", EXAMPLE_CONFIG);
    console.log(chalk.green("✓ Created conduit.yaml"));
  }

  if (!existsSync("specs")) {
    mkdirSync("specs", { recursive: true });
  }

  const examplePath = "specs/example-feature.md";
  if (!existsSync(examplePath)) {
    writeFileSync(examplePath, EXAMPLE_SPEC);
    console.log(chalk.green(`✓ Created ${examplePath}`));
  }

  if (!existsSync(".conduit")) {
    mkdirSync(".conduit", { recursive: true });
  }

  console.log("");
  console.log(chalk.bold("Next steps:"));
  console.log("  1. Edit conduit.yaml with your Linear/Jira project key");
  console.log("  2. Set environment variables (see .env.example)");
  console.log("  3. Write your spec in specs/");
  console.log("  4. Run: conduit generate --dry-run");
}
