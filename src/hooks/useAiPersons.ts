/**
 * useAiPersons — dedicated hook for AI requisites persons section.
 *
 * Loads all person records from legal_details_persons for current user.
 * Mutations: create, update, deactivate (is_active=false).
 * Completely independent from entity module / useLegalDetails.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

export type PersonRow = Database["public"]["Tables"]["legal_details_persons"]["Row"];
type PersonInsert = Database["public"]["Tables"]["legal_details_persons"]["Insert"];
type PersonUpdate = Database["public"]["Tables"]["legal_details_persons"]["Update"];

export function useAiPersons() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

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

  const { data: allPersons = [], isLoading } = useQuery({
    queryKey: ["ai-persons", profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const { data, error } = await supabase
        .from("legal_details_persons")
        .select("*")
        .eq("profile_id", profileId)
        .order("is_active", { ascending: false })
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data as PersonRow[];
    },
    enabled: !!profileId,
  });

  const createMutation = useMutation({
    mutationFn: async (details: Omit<PersonInsert, "profile_id">) => {
      if (!profileId) throw new Error("Профиль не найден");
      const { data, error } = await supabase
        .from("legal_details_persons")
        .insert({ ...details, profile_id: profileId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-persons"] });
      toast.success("Физлицо сохранено");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...details }: PersonUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("legal_details_persons")
        .update(details)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-persons"] });
      toast.success("Данные обновлены");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("legal_details_persons")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-persons"] });
      toast.success("Запись деактивирована");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  return {
    profileId,
    allPersons,
    isLoading,
    createPerson: createMutation.mutateAsync,
    updatePerson: updateMutation.mutateAsync,
    deactivatePerson: deactivateMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeactivating: deactivateMutation.isPending,
  };
}
