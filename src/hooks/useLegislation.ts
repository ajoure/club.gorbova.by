import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LegalDocument, LegalDocumentPreview } from "@/types/legislation";

export function usePublishedLegislation() {
  return useQuery({
    queryKey: ["legislation", "published"],
    queryFn: async (): Promise<LegalDocument[]> => {
      const { data, error } = await supabase
        .from("legal_documents")
        .select(
          "id,external_id,slug,source,source_url,title,doc_type,doc_date,doc_number,category,status,organ,effective_at,revision_label,is_published,last_synced_at,created_at,updated_at",
        )
        .eq("is_published", true)
        .order("category")
        .order("title");

      if (error) throw error;
      return (data ?? []) as LegalDocument[];
    },
  });
}

export function useLegalDocument(slug: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["legislation", "document", slug],
    enabled: Boolean(slug) && enabled,
    queryFn: async (): Promise<LegalDocument | null> => {
      const { data, error } = await supabase
        .from("legal_documents")
        .select("*")
        .eq("slug", slug)
        .eq("is_published", true)
        .maybeSingle();

      if (error) throw error;
      return data as LegalDocument | null;
    },
  });
}

export function useLegalDocumentPreview(slug: string | undefined) {
  return useQuery({
    queryKey: ["legislation", "preview", slug],
    enabled: Boolean(slug),
    queryFn: async (): Promise<LegalDocumentPreview | null> => {
      const { data, error } = await supabase.rpc("get_legal_document_preview", {
        p_slug: slug,
      });

      if (error) throw error;
      return (data?.[0] ?? null) as LegalDocumentPreview | null;
    },
  });
}
