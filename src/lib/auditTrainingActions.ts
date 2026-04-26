/**
 * Безопасная запись training-событий в audit_logs через SECURITY DEFINER RPC.
 *
 * Прямой INSERT в audit_logs из клиента запрещён RLS (нужен audit.view либо service_role).
 * Функция log_training_event разрешает любому authenticated писать ТОЛЬКО события
 * с префиксом `training.`. Логирование best-effort: ошибка не должна ломать UX.
 */

import { supabase } from "@/integrations/supabase/client";

export type TrainingAuditAction =
  | "training.external_product_workshop.completed"
  | "training.external_product_workshop.reopened"
  | "training.student_response.exported"
  | "training.lesson_progress.exported";

export interface TrainingAuditMeta {
  lesson_id?: string | null;
  block_id?: string | null;
  student_user_id?: string | null;
  source?: "student" | "student_self" | "teacher" | "system";
  format?: "json" | "csv";
  client_types_count?: number;
  portfolio_count?: number;
  completed?: boolean;
  [k: string]: unknown;
}

export async function logTrainingEvent(
  action: TrainingAuditAction,
  targetUserId: string | null,
  meta: TrainingAuditMeta = {}
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const { data, error } = await supabase.rpc("log_training_event", {
      _action: action,
      _target_user_id: targetUserId,
      _meta: meta as never,
    });
    if (error) {
      console.warn("[logTrainingEvent] RPC failed:", action, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data as unknown as string };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[logTrainingEvent] threw:", action, msg);
    return { ok: false, error: msg };
  }
}
