/**
 * useEntityPersonLinks — CRUD hook for entity↔person links.
 * Loads links with joins, catalogs, and provides mutations.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface LinkRow {
  id: string;
  person_id: string;
  legal_details_id: string;
  role_catalog_id: string;
  role_type: string;
  position_catalog_id: string | null;
  custom_role_text: string | null;
  custom_position_text: string | null;
  share_percent: number | null;
  acts_on_basis: string | null;
  is_primary: boolean;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
  // joined
  person_full_name: string | null;
  person_personal_number: string | null;
  person_is_active: boolean;
  role_label: string | null;
  position_label: string | null;
}

export interface RoleCatalogEntry {
  id: string;
  label: string;
  role_type: string;
  code: string;
}

export interface PositionCatalogEntry {
  id: string;
  label: string;
  code: string;
}

export interface LinkInsertPayload {
  person_id: string;
  legal_details_id: string;
  role_catalog_id: string;
  role_type: string;
  profile_id: string;
  position_catalog_id?: string | null;
  custom_role_text?: string | null;
  custom_position_text?: string | null;
  share_percent?: number | null;
  acts_on_basis?: string | null;
  is_primary?: boolean;
  notes?: string | null;
}

function parseUniqueViolation(error: any): string | null {
  if (error?.code === "23505") return "Такая связь уже существует";
  if (error?.code === "23514") return "Данные не прошли проверку (CHECK constraint)";
  return null;
}

export function useEntityPersonLinks(legalDetailsId: string | null, profileId: string | null) {
  const queryClient = useQueryClient();

  const { data: links = [], isLoading: linksLoading } = useQuery({
    queryKey: ["entity-person-links", legalDetailsId],
    queryFn: async () => {
      if (!legalDetailsId) return [];
      const { data, error } = await supabase
        .from("legal_details_entity_person_links")
        .select(`
          id, person_id, legal_details_id, role_catalog_id, role_type,
          position_catalog_id, custom_role_text, custom_position_text,
          share_percent, acts_on_basis, is_primary, start_date, end_date, notes, created_at,
          legal_details_persons!legal_details_entity_person_links_person_id_fkey (
            full_name, personal_number, is_active
          ),
          legal_details_roles_catalog!legal_details_entity_person_links_role_catalog_id_fkey (
            label
          ),
          legal_details_positions_catalog!legal_details_entity_person_links_position_catalog_id_fkey (
            label
          )
        `)
        .eq("legal_details_id", legalDetailsId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Failed to load links:", error);
        return [];
      }

      return (data || []).map((row: any): LinkRow => ({
        id: row.id,
        person_id: row.person_id,
        legal_details_id: row.legal_details_id,
        role_catalog_id: row.role_catalog_id,
        role_type: row.role_type,
        position_catalog_id: row.position_catalog_id,
        custom_role_text: row.custom_role_text,
        custom_position_text: row.custom_position_text,
        share_percent: row.share_percent,
        acts_on_basis: row.acts_on_basis,
        is_primary: row.is_primary,
        start_date: row.start_date,
        end_date: row.end_date,
        notes: row.notes,
        created_at: row.created_at,
        person_full_name: row.legal_details_persons?.full_name ?? null,
        person_personal_number: row.legal_details_persons?.personal_number ?? null,
        person_is_active: row.legal_details_persons?.is_active ?? true,
        role_label: row.legal_details_roles_catalog?.label ?? null,
        position_label: row.legal_details_positions_catalog?.label ?? null,
      }));
    },
    enabled: !!legalDetailsId,
  });

  const { data: rolesCatalog = [] } = useQuery({
    queryKey: ["roles-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_details_roles_catalog")
        .select("id, label, role_type, code")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as RoleCatalogEntry[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: positionsCatalog = [] } = useQuery({
    queryKey: ["positions-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_details_positions_catalog")
        .select("id, label, code")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as PositionCatalogEntry[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const invalidateLinks = (...personIds: (string | undefined | null)[]) => {
    queryClient.invalidateQueries({ queryKey: ["entity-person-links", legalDetailsId] });
    const seen = new Set<string>();
    for (const pid of personIds) {
      if (pid && !seen.has(pid)) {
        seen.add(pid);
        queryClient.invalidateQueries({ queryKey: ["person-linked-entities", pid] });
      }
    }
  };

  const createLink = useMutation({
    mutationFn: async (payload: LinkInsertPayload) => {
      const { data, error } = await supabase
        .from("legal_details_entity_person_links")
        .insert(payload)
        .select()
        .single();
      if (error) {
        const friendly = parseUniqueViolation(error);
        throw new Error(friendly || error.message);
      }
      return data;
    },
    onSuccess: (_data, variables) => {
      invalidateLinks(variables.person_id);
      toast.success("Связь добавлена");
    },
    onError: (error) => toast.error(error.message),
  });

  const updateLink = useMutation({
    mutationFn: async ({ id, old_person_id, ...payload }: Partial<LinkInsertPayload> & { id: string; old_person_id?: string }) => {
      const { data, error } = await supabase
        .from("legal_details_entity_person_links")
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (error) {
        const friendly = parseUniqueViolation(error);
        throw new Error(friendly || error.message);
      }
      return { ...data, old_person_id };
    },
    onSuccess: (data: any, variables) => {
      invalidateLinks(variables.old_person_id, data.person_id);
      toast.success("Связь обновлена");
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteLink = useMutation({
    mutationFn: async ({ id, person_id }: { id: string; person_id: string }) => {
      const { error } = await supabase
        .from("legal_details_entity_person_links")
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
      return { person_id };
    },
    onSuccess: (_data, variables) => {
      invalidateLinks(variables.person_id);
      toast.success("Связь удалена");
    },
    onError: (error) => toast.error(error.message),
  });

  return {
    links,
    linksLoading,
    rolesCatalog,
    positionsCatalog,
    createLink: createLink.mutateAsync,
    updateLink: updateLink.mutateAsync,
    deleteLink: deleteLink.mutateAsync,
    isCreating: createLink.isPending,
    isUpdating: updateLink.isPending,
    isDeleting: deleteLink.isPending,
  };
}
