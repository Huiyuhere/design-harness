import { env } from "cloudflare:workers";
import { BrandDocument, DocumentProposal } from "./brand-documents";
import { RequestUser } from "./request-security";

export type ProjectIdentity = { id: string; name: string; repository: string; baseSha: string };

function database() {
  if (!env.DB) throw new Error("Project memory is unavailable because the D1 binding is missing.");
  return env.DB;
}

export async function ensureProject(user: RequestUser, project: ProjectIdentity) {
  const db = database();
  const stamp = new Date().toISOString();
  const existing = await db.prepare("SELECT owner_id FROM projects WHERE id = ?").bind(project.id).first<{ owner_id: string }>();
  if (existing && existing.owner_id !== user.userId) throw new Error("This project belongs to a different signed-in user.");
  await db.batch([
    db.prepare("INSERT INTO owners (id, email, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at").bind(user.userId, user.email, stamp, stamp),
    db.prepare("INSERT INTO projects (id, owner_id, name, repository_full_name, base_sha, draft_branch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, repository_full_name = excluded.repository_full_name, base_sha = excluded.base_sha, updated_at = excluded.updated_at").bind(project.id, user.userId, project.name, project.repository, project.baseSha, `design-harness/${project.id}`, stamp, stamp),
  ]);
}

export async function ensureThread(user: RequestUser, project: ProjectIdentity, threadId: string, model: string) {
  await ensureProject(user, project);
  const db = database();
  const stamp = new Date().toISOString();
  await db.prepare("INSERT INTO agent_threads (id, project_id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET model = excluded.model, updated_at = excluded.updated_at").bind(threadId, project.id, "Design agent", model, stamp, stamp).run();
}

export async function saveAgentMessage(input: { id?: string; user: RequestUser; project: ProjectIdentity; threadId: string; role: "user" | "assistant"; content: string; contextReceipt: unknown; status: string; durationMs?: number | null }) {
  const db = database();
  const stamp = new Date().toISOString();
  const id = input.id ?? crypto.randomUUID();
  await db.prepare("INSERT INTO agent_messages (id, thread_id, project_id, owner_id, role, content, context_receipt_json, status, duration_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, input.threadId, input.project.id, input.user.userId, input.role, input.content.slice(0, 80_000), JSON.stringify(input.contextReceipt), input.status, input.durationMs ?? null, stamp, stamp).run();
  return id;
}

export async function saveFlowGap(user: RequestUser, project: ProjectIdentity, gap: { id: string; frameId: string; node: string; label: string; role?: string; sourceAnchor?: unknown; computedStyle?: unknown; clickCount: number; suggestedRoute: string; status: string; firstSeenAt: string; lastClickedAt: string }) {
  await ensureProject(user, project);
  const db = database();
  const stamp = new Date().toISOString();
  await db.prepare(`INSERT INTO flow_gaps (id, project_id, owner_id, frame_id, node, label, role, source_anchor_json, computed_style_json, click_count, suggested_route, status, first_seen_at, last_clicked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, frame_id, node) DO UPDATE SET label = excluded.label, role = excluded.role, source_anchor_json = excluded.source_anchor_json, computed_style_json = excluded.computed_style_json, click_count = excluded.click_count, suggested_route = excluded.suggested_route, status = excluded.status, last_clicked_at = excluded.last_clicked_at, updated_at = excluded.updated_at`)
    .bind(gap.id, project.id, user.userId, gap.frameId, gap.node, gap.label, gap.role ?? "control", JSON.stringify(gap.sourceAnchor ?? {}), JSON.stringify(gap.computedStyle ?? {}), gap.clickCount, gap.suggestedRoute, gap.status, gap.firstSeenAt, gap.lastClickedAt, stamp, stamp).run();
}

export async function saveContextSnapshot(user: RequestUser, project: ProjectIdentity, document: BrandDocument, parsed: unknown, status = "authoritative") {
  await ensureProject(user, project);
  const db = database();
  const stamp = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO project_context_snapshots (id, project_id, owner_id, kind, path, source_hash, content, parsed_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, path, source_hash) DO UPDATE SET parsed_json = excluded.parsed_json, status = excluded.status, updated_at = excluded.updated_at`)
    .bind(id, project.id, user.userId, document.kind, document.path, document.sourceHash, document.content.slice(0, 120_000), JSON.stringify(parsed), status, stamp, stamp).run();
}

export async function saveMemories(user: RequestUser, project: ProjectIdentity, memories: Array<{ category: string; content: string; provenanceType: string; provenanceId: string }>) {
  await ensureProject(user, project);
  const db = database();
  const stamp = new Date().toISOString();
  for (const memory of memories.slice(0, 60)) {
    const duplicate = await db.prepare("SELECT id FROM project_memories WHERE project_id = ? AND category = ? AND content = ? LIMIT 1").bind(project.id, memory.category, memory.content).first();
    if (duplicate) continue;
    await db.prepare("INSERT INTO project_memories (id, project_id, category, content, provenance_type, provenance_id, approved_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), project.id, memory.category, memory.content, memory.provenanceType, memory.provenanceId, user.userId, stamp, stamp).run();
  }
}

export async function saveProposal(user: RequestUser, project: ProjectIdentity, proposal: DocumentProposal) {
  await ensureProject(user, project);
  const db = database();
  const stamp = new Date().toISOString();
  await db.prepare("INSERT INTO design_document_proposals (id, project_id, owner_id, kind, path, base_hash, original_content, proposed_content, diff, rationale, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(proposal.id, project.id, user.userId, proposal.kind, proposal.path, proposal.baseHash, proposal.originalContent, proposal.proposedContent, proposal.diff, proposal.rationale, proposal.status, stamp, stamp).run();
}

export async function updateProposalStatus(user: RequestUser, project: ProjectIdentity, proposalId: string, status: "applied" | "rejected", currentHash?: string) {
  await ensureProject(user, project);
  const db = database();
  const proposal = await db.prepare("SELECT * FROM design_document_proposals WHERE id = ? AND project_id = ? AND owner_id = ?").bind(proposalId, project.id, user.userId).first<Record<string, string>>();
  if (!proposal) throw new Error("Document proposal not found.");
  if (status === "applied" && currentHash && proposal.base_hash !== currentHash) throw new Error("The document changed after this proposal was generated. Regenerate the improvement before applying it.");
  const stamp = new Date().toISOString();
  await db.prepare("UPDATE design_document_proposals SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?").bind(status, stamp, proposalId, user.userId).run();
  return {
    id: proposal.id, path: proposal.path, kind: proposal.kind, baseHash: proposal.base_hash, originalContent: proposal.original_content,
    proposedContent: proposal.proposed_content, diff: proposal.diff, rationale: proposal.rationale, status,
  } as DocumentProposal;
}

export async function loadProjectContext(user: RequestUser, project: ProjectIdentity) {
  await ensureProject(user, project);
  const db = database();
  const [memories, gaps, documents, messages] = await Promise.all([
    db.prepare("SELECT id, category, content, provenance_type, provenance_id FROM project_memories WHERE project_id = ? ORDER BY updated_at DESC LIMIT 40").bind(project.id).all(),
    db.prepare("SELECT id, frame_id, node, label, role, suggested_route, click_count, status FROM flow_gaps WHERE project_id = ? AND owner_id = ? AND status = 'open' ORDER BY last_clicked_at DESC LIMIT 30").bind(project.id, user.userId).all(),
    db.prepare("SELECT kind, path, source_hash, content, status FROM project_context_snapshots WHERE project_id = ? AND owner_id = ? ORDER BY updated_at DESC LIMIT 12").bind(project.id, user.userId).all(),
    db.prepare("SELECT role, content, created_at FROM agent_messages WHERE project_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT 12").bind(project.id, user.userId).all(),
  ]);
  return { memories: memories.results, gaps: gaps.results, documents: documents.results, messages: [...messages.results].reverse() };
}
