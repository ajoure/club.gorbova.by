import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type ClientType = "individual" | "entrepreneur" | "legal_entity";

export interface ClientLegalDetails {
  id: string;
  profile_id: string;
  client_type: ClientType;
  is_default: boolean;
  
  // Individual fields
  ind_full_name: string | null;
  ind_birth_date: string | null;
  ind_passport_series: string | null;
  ind_passport_number: string | null;
  ind_passport_issued_by: string | null;
  ind_passport_issued_date: string | null;
  ind_passport_valid_until: string | null;
  ind_personal_number: string | null;
  ind_address_index: string | null;
  ind_address_region: string | null;
  ind_address_district: string | null;
  ind_address_city: string | null;
  ind_address_street: string | null;
  ind_address_house: string | null;
  ind_address_apartment: string | null;
  
  // Entrepreneur fields
  ent_name: string | null;
  ent_unp: string | null;
  ent_address: string | null;
  ent_acts_on_basis: string | null;
  
  // Legal entity fields
  leg_org_form: string | null;
  leg_name: string | null;
  leg_unp: string | null;
  leg_address: string | null;
  leg_director_position: string | null;
  leg_director_name: string | null;
  leg_acts_on_basis: string | null;
  
  // Common fields
  bank_account: string | null;
  bank_name: string | null;
  bank_code: string | null;
  phone: string | null;
  email: string | null;
  
  // Validation
  validation_status: string | null;
  validation_errors: Record<string, string> | null;
  validated_at: string | null;
  
  created_at: string;
  updated_at: string;
}

export interface Executor {
  id: string;
  full_name: string;
  short_name: string | null;
  unp: string;
  legal_address: string;
  bank_account: string;
  bank_name: string;
  bank_code: string;
  phone: string | null;
  email: string | null;
  director_position: string | null;
  director_full_name: string | null;
  director_short_name: string | null;
  acts_on_basis: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function useLegalDetails() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch user's profile ID first
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

  // Fetch user's legal details
  const { data: legalDetails, isLoading } = useQuery({
    queryKey: ["client-legal-details", profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];
      const { data, error } = await supabase
        .from("client_legal_details")
        .select("*")
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as ClientLegalDetails[];
    },
    enabled: !!profile?.id,
  });

  // Get default legal details
  const defaultDetails = legalDetails?.find(d => d.is_default) || legalDetails?.[0];

  // Create new legal details
  const createMutation = useMutation({
    mutationFn: async (details: Partial<ClientLegalDetails>) => {
      if (!profile?.id) throw new Error("Профиль не найден");
      
      const { data, error } = await supabase
        .from("client_legal_details")
        .insert({
          ...details,
          profile_id: profile.id,
          is_default: !legalDetails?.length, // First one is default
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-legal-details"] });
      toast.success("Реквизиты сохранены");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  // Update legal details
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...details }: Partial<ClientLegalDetails> & { id: string }) => {
      const { data, error } = await supabase
        .from("client_legal_details")
        .update(details)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-legal-details"] });
      toast.success("Реквизиты обновлены");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  // Delete legal details
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("client_legal_details")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-legal-details"] });
      toast.success("Реквизиты удалены");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  // Set as default
  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!profile?.id) throw new Error("Профиль не найден");
      
      // First, unset all defaults
      await supabase
        .from("client_legal_details")
        .update({ is_default: false })
        .eq("profile_id", profile.id);
      
      // Then set the new default
      const { error } = await supabase
        .from("client_legal_details")
        .update({ is_default: true })
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-legal-details"] });
      toast.success("Реквизиты назначены основными");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  return {
    legalDetails,
    defaultDetails,
    profileId: profile?.id,
    isLoading,
    createDetails: createMutation.mutateAsync,
    updateDetails: updateMutation.mutateAsync,
    deleteDetails: deleteMutation.mutateAsync,
    setDefault: setDefaultMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

export function useExecutors() {
  const queryClient = useQueryClient();

  const { data: executors, isLoading } = useQuery({
    queryKey: ["executors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("executors")
        .select("*")
        .eq("is_active", true)
        .order("is_default", { ascending: false });
      
      if (error) throw error;
      return data as Executor[];
    },
  });

  const defaultExecutor = executors?.find(e => e.is_default) || executors?.[0];

  // Create executor
  const createMutation = useMutation({
    mutationFn: async (executor: Omit<Partial<Executor>, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from("executors")
        .insert(executor as any)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["executors"] });
      toast.success("Исполнитель добавлен");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  // Update executor
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<Executor> & { id: string }) => {
      const { error } = await supabase
        .from("executors")
        .update(data)
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["executors"] });
      toast.success("Исполнитель обновлён");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  // Delete (soft delete)
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("executors")
        .update({ is_active: false })
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["executors"] });
      toast.success("Исполнитель удалён");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  // Set as default
  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      // First unset all defaults
      await supabase
        .from("executors")
        .update({ is_default: false })
        .eq("is_default", true);
      
      const { error } = await supabase
        .from("executors")
        .update({ is_default: true })
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["executors"] });
      toast.success("Исполнитель назначен основным");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  return {
    executors,
    defaultExecutor,
    isLoading,
    createExecutor: createMutation.mutateAsync,
    updateExecutor: updateMutation.mutateAsync,
    deleteExecutor: deleteMutation.mutateAsync,
    setDefault: setDefaultMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
  };
}
