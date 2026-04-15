/**
 * Pipeline Service — business logic for CRM pipelines & stages.
 * UI hooks call these functions; no business logic lives in components.
 */
import { supabase } from "@/integrations/supabase/client";
import { STAGE_PALETTE, SEMANTIC_COLORS, getNextStageColor } from "@/lib/stagePalette";

// ─── Types ───
export interface CrmPipeline {
  id: string;
  public_id: string;
  name: string;
  code: string | null;
  order_index: number;
  is_default: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CrmPipelineStage {
  id: string;
  public_id: string;
  pipeline_id: string;
  name: string;
  color: string;
  stage_type: "open" | "closed_won" | "closed_lost";
  order_index: number;
  is_default: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── Pipelines ───
export async function fetchPipelines(): Promise<CrmPipeline[]> {
  const { data, error } = await supabase
    .from("crm_pipelines")
    .select("*")
    .order("order_index");
  if (error) throw error;
  return (data || []) as unknown as CrmPipeline[];
}

export async function createPipeline(name: string): Promise<CrmPipeline> {
  // Get max order_index
  const { data: existing } = await supabase
    .from("crm_pipelines")
    .select("order_index")
    .order("order_index", { ascending: false })
    .limit(1);
  const nextIndex = (existing?.[0]?.order_index ?? -1) + 1;

  const { data, error } = await supabase
    .from("crm_pipelines")
    .insert({ name, order_index: nextIndex })
    .select()
    .single();
  if (error) throw error;

  // Create default closed stages for every new pipeline
  const stageSeeds = [
    { name: "Новая", color: STAGE_PALETTE[0], order_index: 0, stage_type: "open", is_default: true },
    { name: "В работе", color: STAGE_PALETTE[1], order_index: 1, stage_type: "open", is_default: false },
    { name: "Успешно", color: SEMANTIC_COLORS.closed_won, order_index: 2, stage_type: "closed_won", is_default: false },
    { name: "Отказ", color: SEMANTIC_COLORS.closed_lost, order_index: 3, stage_type: "closed_lost", is_default: false },
  ];
  await supabase.from("crm_pipeline_stages").insert(
    stageSeeds.map((s) => ({ ...s, pipeline_id: data.id }))
  );

  // Audit
  await writeAudit("pipeline.created", { pipeline_id: data.id, name });

  return data as unknown as CrmPipeline;
}

export async function renamePipeline(id: string, name: string) {
  const { error } = await supabase.from("crm_pipelines").update({ name }).eq("id", id);
  if (error) throw error;
  await writeAudit("pipeline.renamed", { pipeline_id: id, name });
}

export async function deletePipeline(id: string) {
  // Check if has deals
  const { count } = await supabase
    .from("orders_v2")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_id", id);
  if ((count || 0) > 0) {
    throw new Error("Нельзя удалить воронку с привязанными сделками. Перенесите сделки сначала.");
  }
  // Delete stages first (RESTRICT won't allow pipeline delete otherwise)
  const { error: stagesErr } = await supabase
    .from("crm_pipeline_stages")
    .delete()
    .eq("pipeline_id", id);
  if (stagesErr) throw stagesErr;

  // Delete bindings
  await supabase.from("crm_pipeline_product_bindings").delete().eq("pipeline_id", id);

  const { error } = await supabase.from("crm_pipelines").delete().eq("id", id);
  if (error) throw error;
  await writeAudit("pipeline.deleted", { pipeline_id: id });
}

// ─── Stages ───
export async function fetchStages(pipelineId: string): Promise<CrmPipelineStage[]> {
  const { data, error } = await supabase
    .from("crm_pipeline_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("order_index");
  if (error) throw error;
  return (data || []) as unknown as CrmPipelineStage[];
}

/**
 * Canonical helper: normalizes order_index for all stages in a pipeline.
 * Order: open stages first (preserving relative order), then closed_won, then closed_lost.
 * Two-phase with POSITIVE safe-zone (CHECK order_index >= 0).
 */
async function normalizeStageOrder(pipelineId: string): Promise<void> {
  const stages = await fetchStages(pipelineId);
  if (stages.length === 0) return;

  // Desired order: open first, then closed_won, then closed_lost
  const open = stages.filter((s) => s.stage_type === "open");
  const won = stages.filter((s) => s.stage_type === "closed_won");
  const lost = stages.filter((s) => s.stage_type === "closed_lost");
  const ordered = [...open, ...won, ...lost];

  // Dynamic safe-zone base: guaranteed free range above all current indices
  const maxIdx = Math.max(...stages.map((s) => s.order_index), 0);
  const safeBase = maxIdx + 100;

  // Phase 1: move all to positive safe-zone (safeBase + i)
  for (let i = 0; i < ordered.length; i++) {
    await supabase
      .from("crm_pipeline_stages")
      .update({ order_index: safeBase + i })
      .eq("id", ordered[i].id);
  }

  // Phase 2: assign final sequential indices 0..N
  for (let i = 0; i < ordered.length; i++) {
    await supabase
      .from("crm_pipeline_stages")
      .update({ order_index: i })
      .eq("id", ordered[i].id);
  }
}

export async function createStage(
  pipelineId: string,
  name: string,
  color?: string,
  stageType: "open" | "closed_won" | "closed_lost" = "open"
): Promise<CrmPipelineStage> {
  const stages = await fetchStages(pipelineId);
  const openStages = stages.filter((s) => s.stage_type === "open");

  // Auto-pick color if not provided
  const resolvedColor = color || getNextStageColor(openStages.map((s) => s.color));

  // Dynamic safe-zone: above all current indices
  const maxIdx = Math.max(...stages.map((s) => s.order_index), 0);
  const safeBase = maxIdx + 100;

  // Phase 1: move ALL existing stages to positive safe-zone
  for (let i = 0; i < stages.length; i++) {
    await supabase
      .from("crm_pipeline_stages")
      .update({ order_index: safeBase + i })
      .eq("id", stages[i].id);
  }

  // Phase 2: insert new stage with a temporary safe index (above everything)
  const insertIdx = safeBase + stages.length;
  const { data, error } = await supabase
    .from("crm_pipeline_stages")
    .insert({ pipeline_id: pipelineId, name, color: resolvedColor, stage_type: stageType, order_index: insertIdx })
    .select()
    .single();
  if (error) throw error;

  // Phase 3: normalize entire pipeline order (open -> won -> lost, 0..N)
  await normalizeStageOrder(pipelineId);

  await writeAudit("pipeline_stage.created", { stage_id: data.id, pipeline_id: pipelineId, name });
  return data as unknown as CrmPipelineStage;
}

export async function updateStageColor(id: string, color: string) {
  const { error } = await supabase.from("crm_pipeline_stages").update({ color }).eq("id", id);
  if (error) throw error;
  await writeAudit("pipeline_stage.color_changed", { stage_id: id, color });
}

export async function renameStage(id: string, name: string) {
  const { error } = await supabase.from("crm_pipeline_stages").update({ name }).eq("id", id);
  if (error) throw error;
  await writeAudit("pipeline_stage.renamed", { stage_id: id, name });
}

export async function deleteStageWithRemap(stageId: string, targetStageId: string) {
  // Move all deals from stageId to targetStageId
  const { error: moveErr } = await supabase
    .from("orders_v2")
    .update({ pipeline_stage_id: targetStageId })
    .eq("pipeline_stage_id", stageId);
  if (moveErr) throw moveErr;

  const { error } = await supabase.from("crm_pipeline_stages").delete().eq("id", stageId);
  if (error) throw error;
  await writeAudit("pipeline_stage.deleted", { stage_id: stageId, remapped_to: targetStageId });
}

export async function reorderStages(pipelineId: string, orderedIds: string[]) {
  // Positive safe-zone to avoid unique constraint conflicts (CHECK order_index >= 0)
  const safeBase = orderedIds.length + 100;
  for (let i = 0; i < orderedIds.length; i++) {
    await supabase
      .from("crm_pipeline_stages")
      .update({ order_index: safeBase + i })
      .eq("id", orderedIds[i]);
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await supabase
      .from("crm_pipeline_stages")
      .update({ order_index: i })
      .eq("id", orderedIds[i]);
  }
  await writeAudit("pipeline_stage.reordered", { pipeline_id: pipelineId, order: orderedIds });
}

export async function reorderPipelines(orderedIds: string[]) {
  // Positive safe-zone to avoid unique constraint conflicts
  const safeBase = orderedIds.length + 100;
  for (let i = 0; i < orderedIds.length; i++) {
    await supabase
      .from("crm_pipelines")
      .update({ order_index: safeBase + i })
      .eq("id", orderedIds[i]);
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await supabase
      .from("crm_pipelines")
      .update({ order_index: i })
      .eq("id", orderedIds[i]);
  }
  await writeAudit("pipeline.reordered", { order: orderedIds });
}

// ─── Deal stage changes ───
export async function moveDealToStage(
  dealId: string,
  pipelineId: string,
  newStageId: string,
  oldStageId: string | null
) {
  const { error } = await supabase
    .from("orders_v2")
    .update({ pipeline_id: pipelineId, pipeline_stage_id: newStageId })
    .eq("id", dealId);
  if (error) throw error;
  await writeAudit("deal.stage_changed", {
    deal_id: dealId,
    pipeline_id: pipelineId,
    old_stage_id: oldStageId,
    new_stage_id: newStageId,
  });
}

export async function moveDealToPipeline(
  dealId: string,
  newPipelineId: string,
  newStageId: string,
  oldPipelineId: string | null
) {
  const { error } = await supabase
    .from("orders_v2")
    .update({ pipeline_id: newPipelineId, pipeline_stage_id: newStageId })
    .eq("id", dealId);
  if (error) throw error;
  await writeAudit("deal.pipeline_changed", {
    deal_id: dealId,
    old_pipeline_id: oldPipelineId,
    new_pipeline_id: newPipelineId,
    new_stage_id: newStageId,
  });
}

// ─── Bulk assign deals ───
export async function bulkAssignDealsToStage(
  dealIds: string[],
  pipelineId: string,
  stageId: string
): Promise<{ affected: number }> {
  if (dealIds.length === 0) return { affected: 0 };

  const CHUNK = 200;
  let affected = 0;
  for (let i = 0; i < dealIds.length; i += CHUNK) {
    const chunk = dealIds.slice(i, i + CHUNK);
    const { error, count } = await supabase
      .from("orders_v2")
      .update({ pipeline_id: pipelineId, pipeline_stage_id: stageId })
      .in("id", chunk);
    if (error) throw error;
    affected += count || chunk.length;
  }

  await writeAudit("deal.bulk_stage_assigned", {
    pipeline_id: pipelineId,
    stage_id: stageId,
    deal_ids_count: dealIds.length,
  });

  return { affected };
}

// ─── Audit helper ───
async function writeAudit(action: string, meta: Record<string, unknown>) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("audit_logs").insert([{
      action,
      actor_type: "user",
      actor_user_id: user?.id || null,
      meta: meta as any,
    }]);
  } catch (e) {
    console.error("[pipelineService] audit write failed:", e);
  }
}
