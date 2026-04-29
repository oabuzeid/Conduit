import { writeFileSync, existsSync, mkdirSync } from "fs";
import chalk from "chalk";

const EXAMPLE_CONFIG = `# specbot.yaml
specs:
  - "specs/**/*.md"

tickets:
  provider: linear          # linear | jira
  project: "ENG"            # Linear team key or Jira project key
  mapping:
    epic: h1
    story: h2
    task: "- [ ]"
  labels:
    - "specbot-managed"

# design:
#   provider: figma
#   file_id: "your-figma-file-id"

ai:
  model: "claude-sonnet-4-20250514"
  detail_level: "standard"  # minimal | standard | thorough

sync:
  auto_update: false
  detect_drift: true
  state_file: ".specbot/state.json"
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
  if (existsSync("specbot.yaml")) {
    console.log(chalk.yellow("specbot.yaml already exists — skipping."));
  } else {
    writeFileSync("specbot.yaml", EXAMPLE_CONFIG);
    console.log(chalk.green("✓ Created specbot.yaml"));
  }

  if (!existsSync("specs")) {
    mkdirSync("specs", { recursive: true });
  }

  const examplePath = "specs/example-feature.md";
  if (!existsSync(examplePath)) {
    writeFileSync(examplePath, EXAMPLE_SPEC);
    console.log(chalk.green(`✓ Created ${examplePath}`));
  }

  if (!existsSync(".specbot")) {
    mkdirSync(".specbot", { recursive: true });
  }

  console.log("");
  console.log(chalk.bold("Next steps:"));
  console.log("  1. Edit specbot.yaml with your Linear/Jira project key");
  console.log("  2. Set environment variables (see .env.example)");
  console.log("  3. Write your spec in specs/");
  console.log("  4. Run: specbot generate --dry-run");
}
