/**
 * useAiEntities — dedicated hook for AI requisites section.
 * 
 * Loads all entity records from client_legal_details for current user,
 * splits them by purpose (billing vs document).
 * 
 * Mutations (create/update/archive) are ONLY for document-purpose records.
 * Billing records are read-only in this context.
 * 
 * profileId is resolved internally from useAuth → profiles table.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";

export function useAiEntities() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Resolve profileId from auth user
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

  // Load ALL entity records (including archived) for this owner
  const { data: allEntities, isLoading } = useQuery({
    queryKey: ["ai-entities", profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const { data, error } = await supabase
        .from("client_legal_details")
        .select("*")
        .eq("profile_id", profileId)
        .in("client_type", ["legal_entity", "entrepreneur"])
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as ClientLegalDetails[];
    },
    enabled: !!profileId,
  });

  // Split by purpose and status
  const billingEntities = allEntities?.filter(e => e.purpose === "billing") ?? [];
  const activeDocumentEntities = allEntities?.filter(e => e.purpose === "document" && e.status === "active") ?? [];
  const archivedDocumentEntities = allEntities?.filter(e => e.purpose === "document" && e.status === "archived") ?? [];

  // Create — always document purpose
  const createMutation = useMutation({
    mutationFn: async (details: Partial<ClientLegalDetails>) => {
      if (!profileId) throw new Error("Профиль не найден");
      const { data, error } = await supabase
        .from("client_legal_details")
        .insert({
          ...details,
          profile_id: profileId,
          purpose: "document",
          status: "active",
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-entities"] });
      toast.success("Реквизиты сохранены");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  // Update — only document records
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...details }: Partial<ClientLegalDetails> & { id: string }) => {
      // Guard: verify this is a document record owned by user
      const target = allEntities?.find(e => e.id === id);
      if (!target || target.purpose !== "document") {
        throw new Error("Можно редактировать только документные реквизиты");
      }
      const { data, error } = await supabase
        .from("client_legal_details")
        .update(details)
        .eq("id", id)
        .eq("purpose", "document")
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-entities"] });
      toast.success("Реквизиты обновлены");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  // Archive — only document records
  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      // Guard: verify this is a document record
      const target = allEntities?.find(e => e.id === id);
      if (!target || target.purpose !== "document") {
        throw new Error("Можно архивировать только документные реквизиты");
      }
      const { error } = await supabase
        .from("client_legal_details")
        .update({ status: "archived" })
        .eq("id", id)
        .eq("purpose", "document");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-entities"] });
      toast.success("Реквизиты перемещены в архив");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  return {
    profileId,
    billingEntities,
    activeDocumentEntities,
    archivedDocumentEntities,
    isLoading,
    createEntity: createMutation.mutateAsync,
    updateEntity: updateMutation.mutateAsync,
    archiveEntity: archiveMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isArchiving: archiveMutation.isPending,
  };
}
