// Input/output contract shared by the design-side classifier (#8),
// the reverse-direction analyzer (#1), and the investigation agent (#3).
//
// The classifier and the agent must speak the same shape: the agent should
// never re-classify what the classifier already decided, and the classifier
// should never omit a field the agent needs to route.

export type DesignChangeClassification =
  | "new_screen_added"
  | "screen_removed"
  | "significant_copy_change"
  | "ignore";

export interface StructuralDelta {
  kind: "frame_added" | "frame_removed" | "text_changed";
  node_id: string;
  frame_name: string;
  before?: string;
  after?: string;
  chars_changed?: number;
}

export interface DesignChangeEvent {
  source: "figma";
  file_id: string;
  root_node_id: string;
  classification: DesignChangeClassification;
  structural_deltas: StructuralDelta[];
  semantic_summary: string;
  affected_spec_sections: Array<{ file: string; section: string }>;
  detected_at: string;
}

export interface TicketFieldDiff {
  field: "title" | "description" | "acceptance_criteria" | "labels" | "status";
  before: string;
  after: string;
}

export interface TicketChangeEvent {
  source: "linear" | "jira";
  change_kind: "edited" | "created" | "deleted";
  ticket_id: string;
  ticket_title: string;
  field_diffs: TicketFieldDiff[];
  full_snapshot?: {
    title: string;
    description: string;
    acceptance_criteria?: string[];
    labels: string[];
    status?: string;
  };
  mapped_spec: { file: string; section: string } | null;
  narrative_summary: string;
  detected_at: string;
}

export interface SpecMergeEvent {
  source: "github";
  pr_number: number;
  spec_file: string;
  merged_sections: string[];
  detected_at: string;
}

export type AgentInput = DesignChangeEvent | TicketChangeEvent | SpecMergeEvent;

export type AgentAction =
  | "open_pr_now"
  | "batch_with_pending"
  | "ask_pm"
  | "pause_loop_detected"
  | "no_action";

export interface AgentDecision {
  action: AgentAction;
  reasoning: string;
  pr_payload?: {
    target_spec_file: string;
    branch_name: string;
    edit_summary: string;
  };
  batch_key?: string;
  question?: string;
  loop_evidence?: string;
}
