/**
 * useRepeatableDocumentStaleness — Stage D.1 (frontend-only, read-only).
 *
 * Для документа пакета с режимом per_role_person возвращает:
 *   • latest batch + latest successful batch для пары (session, item);
 *   • счётчик «N/M получателей» по latest successful batch;
 *   • stale-документы (есть в latest batch, но assignment больше не активен);
 *   • missing-ассайнменты (активны, но в latest batch для них нет документа);
 *   • mode_changed: если у item сейчас generation_mode != 'per_role_person',
 *     но в истории есть per_role_person batch.
 *
 * STRICT read-only: никаких update/insert/delete/RPC/edge function вызовов.
 * Сравнение stale/missing считается ТОЛЬКО относительно latest batch
 * и текущего repeat_role_catalog_id. Старые batch — историчны.
 *
 * Не использовать для single-режима — hook возвращает enabled=false.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface RecipientDocRow {
  id: string;
  status: string;
  template_name: string | null;
  title: string | null;
  document_number: string | null;
  document_date: string | null;
  generation_error: string | null;
  file_mime: string | null;
  file_path: string | null;
  created_at: string;
  generation_batch_id: string | null;
  meta: Record<string, any> | null;
  // Извлечённые из meta:
  recipient_assignment_id: string | null;
  recipient_person_id: string | null;
  recipient_display_name: string | null;
  recipient_index: number | null;
  generation_mode: string | null;
  package_item_id: string | null;
}

export interface ActiveAssignmentRow {
  id: string;
  person_id: string;
  sort_order: number;
  person_full_name: string | null;
}

export interface StalenessResult {
  enabled: boolean;
  isLoading: boolean;
  latestBatchId: string | null;
  latestBatchCreatedAt: string | null;
  latestBatchStatus: string | null;
  latestSuccessBatchId: string | null;
  latestSuccessBatchCreatedAt: string | null;
  latestBatchDocs: RecipientDocRow[];
  latestSuccessDocs: RecipientDocRow[];
  generatedCount: number;
  totalRecipients: number;
  stale: RecipientDocRow[];
  missing: ActiveAssignmentRow[];
  hasFailedLastRun: boolean;
}

function extractRecipientFields(row: any): RecipientDocRow {
  const meta = (row.meta ?? {}) as Record<string, any>;
  const recipient = (meta.recipient ?? {}) as Record<string, any>;
  const snapshot = (meta.recipient_snapshot ?? recipient.snapshot ?? {}) as Record<string, any>;
  const displayName =
    (meta.recipient_display_name as string | undefined) ??
    (recipient.display_name as string | undefined) ??
    (snapshot.full_name as string | undefined) ??
    null;
  const personId =
    (meta.recipient_person_id as string | undefined) ??
    (recipient.person_id as string | undefined) ??
    null;
  const assignmentId =
    (meta.repeat_assignment_id as string | undefined) ??
    (recipient.assignment_id as string | undefined) ??
    null;
  const rawIndex =
    meta.recipient_index ?? recipient.index ?? null;
  const recipientIndex =
    rawIndex == null ? null : Number.isFinite(Number(rawIndex)) ? Number(rawIndex) : null;
  return {
    id: row.id,
    status: row.status,
    template_name: row.template_name ?? null,
    title: row.title ?? null,
    document_number: row.document_number ?? null,
    document_date: row.document_date ?? null,
    generation_error: row.generation_error ?? null,
    file_mime: row.file_mime ?? null,
    file_path: row.file_path ?? null,
    created_at: row.created_at,
    generation_batch_id: row.generation_batch_id ?? null,
    meta,
    recipient_assignment_id: assignmentId,
    recipient_person_id: personId,
    recipient_display_name: displayName,
    recipient_index: recipientIndex,
    generation_mode: (meta.generation_mode as string | undefined) ?? null,
    package_item_id:
      (meta.package_item_id as string | undefined) ?? row.package_item_id ?? null,
  };
}

export function useRepeatableDocumentStaleness(params: {
  sessionId: string | null;
  itemId: string | null;
  repeatRoleCatalogId: string | null;
  generationMode: "single" | "per_role_person" | null | undefined;
}): StalenessResult {
  const { sessionId, itemId, repeatRoleCatalogId, generationMode } = params;
  const enabled =
    !!sessionId && !!itemId && !!repeatRoleCatalogId && generationMode === "per_role_person";

  // 1. Все batches сессии (через batch.meta.package_session_id).
  const batchesQuery = useQuery({
    queryKey: ["pkg-staleness", "batches", sessionId],
    enabled: !!sessionId && enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_document_generation_batches")
        .select("id, created_at, status, meta")
        .filter("meta->>package_session_id", "eq", sessionId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        created_at: string;
        status: string;
        meta: Record<string, any> | null;
      }>;
    },
  });

  const batchIds = useMemo(
    () => (batchesQuery.data ?? []).map((b) => b.id),
    [batchesQuery.data],
  );

  // 2. Все документы этих batches, фильтрованные по item (meta.package_item_id).
  const docsQuery = useQuery({
    queryKey: ["pkg-staleness", "docs", sessionId, itemId, batchIds.join(",")],
    enabled: enabled && batchIds.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_generated_documents")
        .select(
          "id, status, template_name, title, document_number, document_date, generation_error, file_mime, file_path, package_item_id, generation_batch_id, meta, created_at",
        )
        .in("generation_batch_id", batchIds)
        .filter("meta->>package_item_id", "eq", itemId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map(extractRecipientFields);
    },
  });

  // 3. Активные ассайнменты для (session, item, role).
  const assignmentsQuery = useQuery({
    queryKey: ["pkg-staleness", "assignments", sessionId, itemId, repeatRoleCatalogId],
    enabled,
    staleTime: 15_000,
    queryFn: async (): Promise<ActiveAssignmentRow[]> => {
      const { data: assn, error } = await supabase
        .from("document_package_item_role_assignments" as any)
        .select("id, person_id, sort_order")
        .eq("package_session_id", sessionId!)
        .eq("package_template_item_id", itemId!)
        .eq("role_catalog_id", repeatRoleCatalogId!)
        .eq("is_active", true)
        .not("person_id", "is", null)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      const rows = (assn ?? []) as any[];
      const personIds = Array.from(new Set(rows.map((r) => r.person_id).filter(Boolean)));
      let names: Record<string, string | null> = {};
      if (personIds.length > 0) {
        const { data: persons, error: pe } = await supabase
          .from("legal_details_persons")
          .select("id, full_name")
          .in("id", personIds);
        if (pe) throw pe;
        for (const p of persons ?? []) names[(p as any).id] = (p as any).full_name ?? null;
      }
      return rows.map((r) => ({
        id: r.id,
        person_id: r.person_id,
        sort_order: r.sort_order ?? 0,
        person_full_name: names[r.person_id] ?? null,
      }));
    },
  });

  return useMemo<StalenessResult>(() => {
    if (!enabled) {
      return {
        enabled: false,
        isLoading: false,
        latestBatchId: null,
        latestBatchCreatedAt: null,
        latestBatchStatus: null,
        latestSuccessBatchId: null,
        latestSuccessBatchCreatedAt: null,
        latestBatchDocs: [],
        latestSuccessDocs: [],
        generatedCount: 0,
        totalRecipients: 0,
        stale: [],
        missing: [],
        hasFailedLastRun: false,
      };
    }

    const isLoading =
      batchesQuery.isLoading || docsQuery.isLoading || assignmentsQuery.isLoading;

    const batches = batchesQuery.data ?? [];
    const docs = docsQuery.data ?? [];
    const assignments = assignmentsQuery.data ?? [];

    // latest batch (по created_at batch'а).
    const latestBatch = batches[0] ?? null;
    const latestBatchId = latestBatch?.id ?? null;

    // latest successful batch — у которого среди docs этого item
    // есть хотя бы один status='generated'.
    let latestSuccessBatch:
      | { id: string; created_at: string; status: string }
      | null = null;
    for (const b of batches) {
      const bdocs = docs.filter((d) => d.generation_batch_id === b.id);
      if (bdocs.some((d) => d.status === "generated")) {
        latestSuccessBatch = b;
        break;
      }
    }

    const latestBatchDocs = latestBatchId
      ? docs.filter((d) => d.generation_batch_id === latestBatchId)
      : [];
    const latestSuccessDocs = latestSuccessBatch
      ? docs.filter((d) => d.generation_batch_id === latestSuccessBatch!.id)
      : [];

    // stale: документы latest batch с assignment_id, которого нет в active.
    const activeAssnIds = new Set(assignments.map((a) => a.id));
    const stale = latestBatchDocs.filter(
      (d) =>
        d.recipient_assignment_id != null &&
        !activeAssnIds.has(d.recipient_assignment_id),
    );

    // missing: active assignment без документа в latest batch.
    const latestAssnIds = new Set(
      latestBatchDocs
        .map((d) => d.recipient_assignment_id)
        .filter((x): x is string => !!x),
    );
    const missing = assignments.filter((a) => !latestAssnIds.has(a.id));

    // N/M по latest successful batch.
    const generatedCount = latestSuccessDocs.filter((d) => d.status === "generated").length;
    const totalRecipients = assignments.length;

    const hasFailedLastRun =
      !!latestBatch &&
      (latestBatch.status === "failed" ||
        latestBatch.status === "blocked" ||
        latestBatch.status === "error" ||
        latestBatch.status === "partial");

    return {
      enabled: true,
      isLoading,
      latestBatchId,
      latestBatchCreatedAt: latestBatch?.created_at ?? null,
      latestBatchStatus: latestBatch?.status ?? null,
      latestSuccessBatchId: latestSuccessBatch?.id ?? null,
      latestSuccessBatchCreatedAt: latestSuccessBatch?.created_at ?? null,
      latestBatchDocs,
      latestSuccessDocs,
      generatedCount,
      totalRecipients,
      stale,
      missing,
      hasFailedLastRun,
    };
  }, [
    enabled,
    batchesQuery.data,
    docsQuery.data,
    assignmentsQuery.data,
    batchesQuery.isLoading,
    docsQuery.isLoading,
    assignmentsQuery.isLoading,
  ]);
}
