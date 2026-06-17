/**
 * useAtomicDocumentSave — Stage 2 of PATCH-PACKAGE-CROSS-PARITY-V1.
 *
 * Тонкая обёртка над RPC `save_session_document_atomic`: за один сетевой
 * вызов сохраняет поля документа (sparse patch) и desired-state ролей
 * одного package-template-item. Атомарность гарантируется на стороне БД.
 *
 * Invalidate queries — только после `ok: true`. При ошибке dirty-state в
 * вызывающем компоненте сохраняется, точная серверная ошибка
 * прокидывается наверх (нормализация — в вызывающем коде через
 * `normalizeEdgeFunctionError`).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AtomicFieldPatch {
  field_catalog_id: string;
  value: string | null;
}

export interface AtomicRoleAssignment {
  role_catalog_id: string;
  person_id: string;
  position?: string | null;
  sort_order?: number;
}

export interface AtomicSaveArgs {
  sessionId: string;
  packageTemplateItemId: string;
  fields: AtomicFieldPatch[];
  rolesDesired: AtomicRoleAssignment[];
  expectedTemplateVersionId?: string | null;
}

export interface AtomicSaveResult {
  ok: boolean;
  written_fields: number;
  written_roles: number;
  deleted_roles: number;
  template_version_id: string | null;
  audit_id: string | null;
}

export function useAtomicDocumentSave() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: AtomicSaveArgs): Promise<AtomicSaveResult> => {
      const { data, error } = await (supabase.rpc as any)(
        "save_session_document_atomic",
        {
          _session_id: args.sessionId,
          _package_template_item_id: args.packageTemplateItemId,
          _field_values: args.fields,
          _role_assignments: args.rolesDesired,
          _expected_template_version_id: args.expectedTemplateVersionId ?? null,
        },
      );
      if (error) throw error;
      return data as AtomicSaveResult;
    },
    onSuccess: (_data, vars) => {
      // Inv只алидация после `ok:true` — никакого optimistic UI.
      qc.invalidateQueries({ queryKey: ["doc-item-role-assignments", vars.sessionId, vars.packageTemplateItemId] });
      qc.invalidateQueries({ queryKey: ["pkg-session-field-values"] });
      qc.invalidateQueries({ queryKey: ["pkg-gen-role-assignments"] });
      qc.invalidateQueries({ queryKey: ["doc-pkg-session-q"] });
    },
  });
}
