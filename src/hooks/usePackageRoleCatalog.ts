/**
 * usePackageRoleCatalog — Sprint 3F Phase 2.
 *
 * CRUD-хук per-package для `document_package_role_catalog`.
 * Канонический формат токена роли в Word: `{{package.role.PKR-XXXXXX}}` —
 * один placeholder на роль; вывод определяется `output_template` роли.
 *
 * Запрещено:
 *  • менять `public_id` / `package_template_id` после создания (защищено триггером БД);
 *  • для `is_system=true` менять `role_key`, `is_system` (защищено триггером БД);
 *  • hard delete системных ролей (защищено триггером БД).
 *
 * Разрешено: создавать custom-роли, менять метаданные, soft-archive (`is_active=false`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface PackageRoleRow {
  id: string;
  public_id: string;
  package_template_id: string;
  role_key: string;
  label: string;
  description: string | null;
  allowed_entity_types: string[];
  required: boolean;
  min_count: number | null;
  max_count: number | null;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
  output_template: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreatePackageRoleInput {
  package_template_id: string;
  label: string;
  description?: string | null;
  allowed_entity_types?: string[];
  required?: boolean;
  min_count?: number | null;
  max_count?: number | null;
  sort_order?: number;
  output_template?: string | null;
}

export interface UpdatePackageRoleInput {
  id: string;
  label?: string;
  description?: string | null;
  required?: boolean;
  min_count?: number | null;
  max_count?: number | null;
  sort_order?: number;
  output_template?: string | null;
  is_active?: boolean;
}

const QK = (packageTemplateId: string | null) => ["package-role-catalog", packageTemplateId];

/** Slugify русское название в технический role_key (только [a-z0-9_]). */
function slugifyRoleKey(label: string): string {
  const translit: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
    ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const base = label
    .toLowerCase()
    .split("")
    .map((ch) => translit[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base.length > 0 ? base : `role_${Date.now().toString(36)}`;
}

export function usePackageRoleCatalog(packageTemplateId: string | null) {
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: QK(packageTemplateId),
    queryFn: async () => {
      if (!packageTemplateId) return [] as PackageRoleRow[];
      const { data, error } = await supabase
        .from("document_package_role_catalog")
        .select("*")
        .eq("package_template_id", packageTemplateId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PackageRoleRow[];
    },
    enabled: !!packageTemplateId,
  });

  const createMutation = useMutation({
    mutationFn: async (input: CreatePackageRoleInput) => {
      const label = input.label.trim();
      if (!label) throw new Error("Название роли обязательно");

      // Build a unique role_key per package. Append suffix if collision.
      let base = slugifyRoleKey(label);
      const { data: existing } = await supabase
        .from("document_package_role_catalog")
        .select("role_key")
        .eq("package_template_id", input.package_template_id);
      const taken = new Set((existing ?? []).map((r) => r.role_key));
      let key = base;
      let i = 2;
      while (taken.has(key)) {
        key = `${base}_${i}`;
        i += 1;
      }

      const payload = {
        package_template_id: input.package_template_id,
        role_key: key,
        label,
        description: input.description ?? null,
        allowed_entity_types: input.allowed_entity_types ?? ["person"],
        required: input.required ?? false,
        min_count: input.min_count ?? null,
        max_count: input.max_count ?? null,
        sort_order: input.sort_order ?? 100,
        is_active: true,
        is_system: false,
        output_template: input.output_template ?? null,
      };
      const { data, error } = await supabase
        .from("document_package_role_catalog")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      return data as PackageRoleRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(packageTemplateId) });
      toast.success("Роль создана");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (input: UpdatePackageRoleInput) => {
      const { id, ...patch } = input;
      const { error } = await supabase
        .from("document_package_role_catalog")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(packageTemplateId) });
      toast.success("Роль обновлена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Soft-archive: is_active=false. Hard delete запрещён политикой. */
  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("document_package_role_catalog")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(packageTemplateId) });
      toast.success("Роль архивирована");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("document_package_role_catalog")
        .update({ is_active: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(packageTemplateId) });
      toast.success("Роль восстановлена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    roles: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    create: createMutation.mutate,
    creating: createMutation.isPending,
    update: updateMutation.mutate,
    updating: updateMutation.isPending,
    archive: archiveMutation.mutate,
    restore: restoreMutation.mutate,
  };
}
