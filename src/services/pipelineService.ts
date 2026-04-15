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
    { name: "Новая", color: "#6366f1", order_index: 0, stage_type: "open", is_default: true },
    { name: "В работе", color: "#f59e0b", order_index: 1, stage_type: "open", is_default: false },
    { name: "Успешно", color: "#22c55e", order_index: 2, stage_type: "closed_won", is_default: false },
    { name: "Отказ", color: "#ef4444", order_index: 3, stage_type: "closed_lost", is_default: false },
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

export async function createStage(
  pipelineId: string,
  name: string,
  color = "#6366f1",
  stageType: "open" | "closed_won" | "closed_lost" = "open"
): Promise<CrmPipelineStage> {
  // Insert before closed stages
  const stages = await fetchStages(pipelineId);
  const closedStages = stages.filter((s) => s.stage_type !== "open");
  const openStages = stages.filter((s) => s.stage_type === "open");
  const newIndex = openStages.length; // after last open, before closed

  // Shift closed stages up
  for (const cs of closedStages) {
    if (cs.order_index >= newIndex) {
      await supabase
        .from("crm_pipeline_stages")
        .update({ order_index: cs.order_index + 1 })
        .eq("id", cs.id);
    }
  }

  const { data, error } = await supabase
    .from("crm_pipeline_stages")
    .insert({ pipeline_id: pipelineId, name, color, stage_type: stageType, order_index: newIndex })
    .select()
    .single();
  if (error) throw error;
  await writeAudit("pipeline_stage.created", { stage_id: data.id, pipeline_id: pipelineId, name });
  return data as unknown as CrmPipelineStage;
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
  // Update order_index for each stage
  // Temporarily set all to negative to avoid unique constraint conflicts
  for (let i = 0; i < orderedIds.length; i++) {
    await supabase
      .from("crm_pipeline_stages")
      .update({ order_index: -(i + 1000) })
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
  // Temporary negative indices to avoid unique constraint conflicts
  for (let i = 0; i < orderedIds.length; i++) {
    await supabase
      .from("crm_pipelines")
      .update({ order_index: -(i + 1000) })
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
