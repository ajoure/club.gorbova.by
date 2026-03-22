/**
 * useAiEntities — dedicated hook for AI requisites section.
 * 
 * Loads all entity records from client_legal_details for current user.
 * Returns allEntities for table + filtered views.
 * 
 * Mutations:
 * - create: always purpose='document'
 * - update: any record (billing or document), but strips purpose/status/is_default
 * - archive: only purpose='document' records
 * 
 * profileId resolved from useAuth → profiles table.
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
  const { data: allEntities = [], isLoading } = useQuery({
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

  // Create — always document purpose
  const createMutation = useMutation({
    mutationFn: async (details: Partial<ClientLegalDetails>) => {
      if (!profileId) throw new Error("Профиль не найден");
      // Strip protected fields
      const { purpose, status, is_default, ...safeDetails } = details as any;
      const { data, error } = await supabase
        .from("client_legal_details")
        .insert({
          ...safeDetails,
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

  // Update — any record owned by user, but never change purpose/status/is_default
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...details }: Partial<ClientLegalDetails> & { id: string }) => {
      const target = allEntities.find(e => e.id === id);
      if (!target) throw new Error("Запись не найдена");
      // Strip protected fields
      const { purpose, status, is_default, ...safeDetails } = details as any;
      const { data, error } = await supabase
        .from("client_legal_details")
        .update(safeDetails)
        .eq("id", id)
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
      const target = allEntities.find(e => e.id === id);
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
    allEntities,
    isLoading,
    createEntity: createMutation.mutateAsync,
    updateEntity: updateMutation.mutateAsync,
    archiveEntity: archiveMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isArchiving: archiveMutation.isPending,
  };
}
