import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const owners = sqliteTable("owners", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("idx_owners_email").on(table.email)]);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => owners.id),
  name: text("name").notNull(),
  repositoryFullName: text("repository_full_name").notNull(),
  baseSha: text("base_sha").notNull(),
  draftBranch: text("draft_branch").notNull(),
  packageManager: text("package_manager"),
  framework: text("framework"),
  trustGrantedAt: text("trust_granted_at"),
  ...timestamps,
}, (table) => [index("idx_projects_owner_id").on(table.ownerId)]);

export const githubInstallations = sqliteTable("github_installations", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => owners.id),
  installationId: text("installation_id").notNull(),
  accountLogin: text("account_login").notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("idx_github_installations_installation_id").on(table.installationId)]);

export const routeFrames = sqliteTable("route_frames", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id),
  route: text("route").notNull(), name: text("name").notNull(), viewportWidth: integer("viewport_width").notNull(), viewportHeight: integer("viewport_height").notNull(),
  x: integer("x").notNull(), y: integer("y").notNull(), thumbnailKey: text("thumbnail_key"), ...timestamps,
}, (table) => [index("idx_route_frames_project_id").on(table.projectId), uniqueIndex("idx_route_frames_project_route").on(table.projectId, table.route)]);

export const frameVariants = sqliteTable("frame_variants", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id), frameId: text("frame_id").notNull().references(() => routeFrames.id),
  profile: text("profile").notNull(), viewportWidth: integer("viewport_width").notNull(), viewportHeight: integer("viewport_height").notNull(), orientation: text("orientation").notNull(),
  x: integer("x").notNull(), y: integer("y").notNull(), scrollJson: text("scroll_json").notNull(), fixtureJson: text("fixture_json").notNull(), thumbnailKey: text("thumbnail_key"),
  sourceHash: text("source_hash"), hydrationStatus: text("hydration_status").notNull(), verificationState: text("verification_state").notNull(), ...timestamps,
}, (table) => [index("idx_frame_variants_project_id").on(table.projectId), uniqueIndex("idx_frame_variants_frame_profile").on(table.frameId, table.profile)]);

export const savedStates = sqliteTable("saved_states", {
  id: text("id").primaryKey(), frameId: text("frame_id").notNull().references(() => routeFrames.id), name: text("name").notNull(), fixtureJson: text("fixture_json").notNull(), screenshotKey: text("screenshot_key"), ...timestamps,
}, (table) => [index("idx_saved_states_frame_id").on(table.frameId)]);

export const graphEdges = sqliteTable("graph_edges", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id), fromFrameId: text("from_frame_id").notNull(), toFrameId: text("to_frame_id").notNull(), kind: text("kind").notNull(), label: text("label"), ...timestamps,
}, (table) => [index("idx_graph_edges_project_id").on(table.projectId)]);

export const designSessions = sqliteTable("design_sessions", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id), name: text("name").notNull(), localCommitSha: text("local_commit_sha"), status: text("status").notNull(), ...timestamps,
}, (table) => [index("idx_design_sessions_project_id").on(table.projectId)]);

export const editTransactions = sqliteTable("edit_transactions", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id), sessionId: text("session_id").references(() => designSessions.id), baseSha: text("base_sha").notNull(), route: text("route").notNull(), stateId: text("state_id"), sourceAnchorJson: text("source_anchor_json").notNull(), operation: text("operation").notNull(), property: text("property").notNull(), beforeValue: text("before_value").notNull(), afterValue: text("after_value").notNull(), affectedFilesJson: text("affected_files_json").notNull(), inversePatch: text("inverse_patch").notNull(), validationJson: text("validation_json").notNull(), status: text("status").notNull(), ...timestamps,
}, (table) => [index("idx_edit_transactions_project_id_created_at").on(table.projectId, table.createdAt), index("idx_edit_transactions_session_id").on(table.sessionId)]);

export const agentThreads = sqliteTable("agent_threads", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id), title: text("title").notNull(), model: text("model").notNull(), previousResponseId: text("previous_response_id"), ...timestamps,
}, (table) => [index("idx_agent_threads_project_id").on(table.projectId)]);

export const agentJobs = sqliteTable("agent_jobs", {
  id: text("id").primaryKey(), threadId: text("thread_id").notNull().references(() => agentThreads.id), repositoryId: text("repository_id").notNull(), kind: text("kind").notNull(), status: text("status").notNull(), progressJson: text("progress_json").notNull(), startedAt: text("started_at"), finishedAt: text("finished_at"), ...timestamps,
}, (table) => [index("idx_agent_jobs_repository_status").on(table.repositoryId, table.status), index("idx_agent_jobs_thread_id").on(table.threadId)]);

export const agentMessages = sqliteTable("agent_messages", {
  id: text("id").primaryKey(), threadId: text("thread_id").notNull().references(() => agentThreads.id), projectId: text("project_id").notNull().references(() => projects.id), ownerId: text("owner_id").notNull().references(() => owners.id),
  role: text("role").notNull(), content: text("content").notNull(), contextReceiptJson: text("context_receipt_json").notNull(), status: text("status").notNull(), durationMs: integer("duration_ms"), ...timestamps,
}, (table) => [index("idx_agent_messages_thread_created").on(table.threadId, table.createdAt), index("idx_agent_messages_project_owner").on(table.projectId, table.ownerId)]);

export const projectMemories = sqliteTable("project_memories", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id), category: text("category").notNull(), content: text("content").notNull(), provenanceType: text("provenance_type").notNull(), provenanceId: text("provenance_id").notNull(), approvedBy: text("approved_by").notNull(), ...timestamps,
}, (table) => [index("idx_project_memories_project_category").on(table.projectId, table.category)]);

export const projectContextSnapshots = sqliteTable("project_context_snapshots", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id), ownerId: text("owner_id").notNull().references(() => owners.id),
  kind: text("kind").notNull(), path: text("path").notNull(), sourceHash: text("source_hash").notNull(), content: text("content").notNull(), parsedJson: text("parsed_json").notNull(), status: text("status").notNull(), ...timestamps,
}, (table) => [uniqueIndex("idx_context_project_path_hash").on(table.projectId, table.path, table.sourceHash), index("idx_context_project_owner").on(table.projectId, table.ownerId)]);

export const designDocumentProposals = sqliteTable("design_document_proposals", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id), ownerId: text("owner_id").notNull().references(() => owners.id),
  kind: text("kind").notNull(), path: text("path").notNull(), baseHash: text("base_hash").notNull(), originalContent: text("original_content").notNull(), proposedContent: text("proposed_content").notNull(), diff: text("diff").notNull(), rationale: text("rationale").notNull(), status: text("status").notNull(), ...timestamps,
}, (table) => [index("idx_document_proposals_project_status").on(table.projectId, table.status), index("idx_document_proposals_owner").on(table.ownerId)]);

export const flowGaps = sqliteTable("flow_gaps", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id), ownerId: text("owner_id").notNull().references(() => owners.id),
  frameId: text("frame_id").notNull(), node: text("node").notNull(), label: text("label").notNull(), role: text("role").notNull(), sourceAnchorJson: text("source_anchor_json").notNull(), computedStyleJson: text("computed_style_json").notNull(), clickCount: integer("click_count").notNull(), suggestedRoute: text("suggested_route").notNull(), screenshotKey: text("screenshot_key"), status: text("status").notNull(), transactionId: text("transaction_id"), firstSeenAt: text("first_seen_at").notNull(), lastClickedAt: text("last_clicked_at").notNull(), ...timestamps,
}, (table) => [uniqueIndex("idx_flow_gaps_project_frame_node").on(table.projectId, table.frameId, table.node), index("idx_flow_gaps_project_status").on(table.projectId, table.status)]);

export const visualValidationRuns = sqliteTable("visual_validation_runs", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id), ownerId: text("owner_id").notNull().references(() => owners.id),
  commitSha: text("commit_sha").notNull(), affectedRoutesJson: text("affected_routes_json").notNull(), status: text("status").notNull(), workflowRunId: text("workflow_run_id"),
  browserResultsJson: text("browser_results_json").notNull(), pixelDiffRatio: integer("pixel_diff_ppm"), artifactKeysJson: text("artifact_keys_json").notNull(), baselineSha: text("baseline_sha"),
  trustedAt: text("trusted_at").notNull(), approvedAt: text("approved_at"), failureReason: text("failure_reason"), durationMs: integer("duration_ms"), ...timestamps,
}, (table) => [index("idx_visual_validation_project_created").on(table.projectId, table.createdAt), index("idx_visual_validation_commit").on(table.commitSha)]);

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id), kind: text("kind").notNull(), objectKey: text("object_key").notNull(), contentType: text("content_type").notNull(), encrypted: integer("encrypted", { mode: "boolean" }).notNull(), sizeBytes: integer("size_bytes").notNull(), ...timestamps,
}, (table) => [index("idx_artifacts_project_id").on(table.projectId), uniqueIndex("idx_artifacts_object_key").on(table.objectKey)]);
