import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface DocumentPackageTemplate {
  id: string;
  profile_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentPackageItem {
  id: string;
  package_template_id: string;
  template_id: string;
  sort_order: number;
  is_required: boolean;
  title_override: string | null;
  created_at: string;
  // joined
  template_name?: string;
  template_document_type?: string;
}

export function useDocumentPackages() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Resolve profiles.id from auth user (same pattern as useAiDocuments)
  const { data: profile } = useQuery({
    queryKey: ["user-profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const profileId = profile?.id ?? null;

  const { data: packages = [], isLoading } = useQuery({
    queryKey: ["document-packages", profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const { data, error } = await supabase
        .from("document_package_templates")
        .select("*")
        .eq("profile_id", profileId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DocumentPackageTemplate[];
    },
    enabled: !!profileId,
  });

  const createPackage = useMutation({
    mutationFn: async (input: { name: string; description?: string }) => {
      if (!profileId) throw new Error("Профиль не найден. Перезагрузите страницу.");
      if (!user) throw new Error("Не авторизован");
      const { data, error } = await supabase
        .from("document_package_templates")
        .insert({
          profile_id: profileId,       // profiles.id
          created_by: user.id,         // auth.users.id
          name: input.name,
          description: input.description || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-packages", profileId] });
      toast.success("Пакет создан");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePackage = useMutation({
    mutationFn: async (input: { id: string; name: string; description?: string; is_active?: boolean }) => {
      const { error } = await supabase
        .from("document_package_templates")
        .update({
          name: input.name,
          description: input.description || null,
          is_active: input.is_active,
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-packages", profileId] });
      toast.success("Пакет обновлён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePackage = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("document_package_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-packages", profileId] });
      toast.success("Пакет удалён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { packages, isLoading, profileId, createPackage, updatePackage, deletePackage };
}

export function useDocumentPackageItems(packageId: string | null) {
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["document-package-items", packageId],
    queryFn: async () => {
      if (!packageId) return [];
      const { data, error } = await supabase
        .from("document_package_template_items")
        .select("*")
        .eq("package_template_id", packageId)
        .order("sort_order", { ascending: true });
      if (error) throw error;

      // Fetch template names
      const templateIds = data.map((d: any) => d.template_id);
      if (templateIds.length === 0) return [];

      const { data: templates } = await supabase
        .from("document_templates")
        .select("id, name, document_type, deleted_at")
        .in("id", templateIds);

      const tplMap = new Map((templates || []).map((t: any) => [t.id, t]));

      return data.map((item: any) => {
        const t: any = tplMap.get(item.template_id);
        const isDeleted = !!t?.deleted_at;
        return {
          ...item,
          template_name: (t?.name ? `${t.name}${isDeleted ? " (удалён)" : ""}` : "—"),
          template_document_type: t?.document_type || "—",
          template_deleted: isDeleted,
        };
      }) as DocumentPackageItem[];
    },
    enabled: !!packageId,
  });

  const addItem = useMutation({
    mutationFn: async (input: { packageId: string; templateId: string; sortOrder?: number }) => {
      const { error } = await supabase
        .from("document_package_template_items")
        .insert({
          package_template_id: input.packageId,
          template_id: input.templateId,
          sort_order: input.sortOrder ?? items.length,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-package-items", packageId] });
      toast.success("Шаблон добавлен в пакет");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from("document_package_template_items")
        .delete()
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-package-items", packageId] });
      toast.success("Шаблон убран из пакета");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderItem = useMutation({
    mutationFn: async (input: { itemId: string; newSortOrder: number }) => {
      const { error } = await supabase
        .from("document_package_template_items")
        .update({ sort_order: input.newSortOrder })
        .eq("id", input.itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-package-items", packageId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { items, isLoading, addItem, removeItem, reorderItem };
}

/** Last successful batch for a package template (for prefill). */
export function useLastPackageBatch(packageTemplateId: string | null, profileId: string | null) {
  return useQuery({
    queryKey: ["last-package-batch", packageTemplateId, profileId],
    queryFn: async () => {
      if (!packageTemplateId || !profileId) return null;
      const { data, error } = await supabase
        .from("ai_document_generation_batches")
        .select("id, title, meta, status, created_at")
        .eq("package_template_id", packageTemplateId)
        .eq("profile_id", profileId)
        .in("status", ["generated", "partial"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as {
        id: string;
        title: string;
        meta: Record<string, unknown>;
        status: string;
        created_at: string;
      } | null;
    },
    enabled: !!packageTemplateId && !!profileId,
  });
}
