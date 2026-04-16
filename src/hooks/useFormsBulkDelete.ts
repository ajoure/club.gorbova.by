/**
 * Bulk-delete для записей раздела /admin/forms.
 *
 * Контракт безопасности (PATCH 3):
 * - DELETE доступен ТОЛЬКО для site_form (`site_form_submissions`) и preorder (`course_preregistrations`)
 * - training НИКОГДА не удаляется (это пользовательский прогресс в lesson_progress_state)
 * - Гард ролей: только admin/super_admin (RLS на таблицах + клиентский guard)
 * - Dry-run summary до execute: сколько site_form, сколько preorder, сколько training будет пропущено
 * - После успеха инвалидируем все relevant queries forms-hub
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { FormsHubRow } from "./useFormsHubData";

export interface FormsDeleteSummary {
  site_form: string[];
  preorder: string[];
  training_skipped: string[];
}

export function buildDeleteSummary(rows: FormsHubRow[]): FormsDeleteSummary {
  const summary: FormsDeleteSummary = {
    site_form: [],
    preorder: [],
    training_skipped: [],
  };
  for (const r of rows) {
    if (r.source_type === "site_form") summary.site_form.push(r.id);
    else if (r.source_type === "preorder") summary.preorder.push(r.id);
    else if (r.source_type === "training") summary.training_skipped.push(r.id);
  }
  return summary;
}

export function useFormsBulkDelete() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (summary: FormsDeleteSummary) => {
      const errors: string[] = [];
      let deletedSite = 0;
      let deletedPre = 0;

      if (summary.site_form.length > 0) {
        const { error, count } = await supabase
          .from("site_form_submissions")
          .delete({ count: "exact" })
          .in("id", summary.site_form);
        if (error) errors.push(`site_forms: ${error.message}`);
        else {
          deletedSite = count ?? 0;
          if (deletedSite === 0 && summary.site_form.length > 0) {
            errors.push(`site_forms: нет прав на удаление (RLS блокирует)`);
          }
        }
      }

      if (summary.preorder.length > 0) {
        const { error, count } = await supabase
          .from("course_preregistrations")
          .delete({ count: "exact" })
          .in("id", summary.preorder);
        if (error) errors.push(`preorders: ${error.message}`);
        else {
          deletedPre = count ?? 0;
          if (deletedPre === 0 && summary.preorder.length > 0) {
            errors.push(`preorders: нет прав на удаление (RLS блокирует)`);
          }
        }
      }

      if (errors.length > 0) {
        throw new Error(errors.join("; "));
      }

      // Audit log (best-effort; do not fail mutation on log error)
      try {
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from("audit_logs").insert({
          action: "bulk_delete_forms",
          actor_type: "user",
          actor_user_id: user?.id ?? null,
          meta: {
            site: deletedSite,
            preorder: deletedPre,
            skipped_training: summary.training_skipped.length,
            requested: {
              site_form: summary.site_form.length,
              preorder: summary.preorder.length,
              training: summary.training_skipped.length,
            },
          },
        });
      } catch (e) {
        console.warn("[useFormsBulkDelete] audit log failed", e);
      }

      return { deletedSite, deletedPre, skippedTraining: summary.training_skipped.length };
    },
    onSuccess: (res) => {
      const parts: string[] = [];
      if (res.deletedSite > 0) parts.push(`анкет: ${res.deletedSite}`);
      if (res.deletedPre > 0) parts.push(`предзаписей: ${res.deletedPre}`);
      const msg = parts.length > 0 ? `Удалено — ${parts.join(", ")}` : "Ничего не удалено";
      toast.success(msg, {
        description: res.skippedTraining > 0
          ? `Пропущено записей обучения: ${res.skippedTraining}`
          : undefined,
      });

      // Invalidate all relevant forms-hub queries
      qc.invalidateQueries({ queryKey: ["forms-hub-data"] });
      qc.invalidateQueries({ queryKey: ["forms-hub-products"] });
      qc.invalidateQueries({ queryKey: ["forms-hub-export-counts"] });
      qc.invalidateQueries({ queryKey: ["admin-preregistrations"] });
      qc.invalidateQueries({ queryKey: ["preregistration-stats"] });
    },
    onError: (e: any) => {
      console.error("[useFormsBulkDelete] error", e);
      toast.error("Ошибка удаления", { description: e?.message || String(e) });
    },
  });
}
