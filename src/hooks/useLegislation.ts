import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  LegalDocument,
  LegalDocumentCollectionRow,
  LegalDocumentPreview,
  LegalDocumentSearchResult,
  LegalDocumentSharePreview,
  LegalSearchResult,
} from "@/types/legislation";

export function useLegalDocumentCollections() {
  return useQuery({
    queryKey: ["legislation", "collections"],
    queryFn: async (): Promise<LegalDocumentCollectionRow[]> => {
      const { data, error } = await supabase.rpc(
        "get_legal_document_collections" as never,
      );
      if (error) throw error;
      return (data ?? []) as unknown as LegalDocumentCollectionRow[];
    },
  });
}

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

export function useLegalDocumentSharePreview(ref: string | undefined) {
  return useQuery({
    queryKey: ["legislation", "share-preview", ref],
    enabled: Boolean(ref),
    queryFn: async (): Promise<LegalDocumentSharePreview | null> => {
      const { data, error } = await supabase.rpc(
        "get_legal_document_share_preview" as never,
        { p_ref: ref } as never,
      );

      if (error) throw error;
      const rows = (data ?? []) as LegalDocumentSharePreview[];
      return rows[0] ?? null;
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
      return data as unknown as LegalDocument | null;
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

export function useLegislationSearch(
  query: string,
  limit = 30,
  enabled = true,
) {
  const normalizedQuery = query.trim();

  return useQuery({
    queryKey: ["legislation", "search", normalizedQuery, limit],
    enabled: enabled && normalizedQuery.length >= 2,
    staleTime: 60_000,
    queryFn: async (): Promise<LegalSearchResult[]> => {
      const { data, error } = await supabase.rpc(
        "search_legal_documents" as never,
        {
          p_query: normalizedQuery,
          p_limit: limit,
        } as never,
      );

      if (error) throw error;
      return (data ?? []) as unknown as LegalSearchResult[];
    },
  });
}

export function useLegalDocumentSearch(
  documentId: string | undefined,
  query: string,
  limit = 40,
  enabled = true,
) {
  const normalizedQuery = query.trim();

  return useQuery({
    queryKey: [
      "legislation",
      "document-search",
      documentId,
      normalizedQuery,
      limit,
    ],
    enabled:
      enabled &&
      Boolean(documentId) &&
      normalizedQuery.length >= 2,
    staleTime: 60_000,
    queryFn: async (): Promise<LegalDocumentSearchResult[]> => {
      const { data, error } = await supabase.rpc(
        "search_legal_document" as never,
        {
          p_document_id: documentId,
          p_query: normalizedQuery,
          p_limit: limit,
        } as never,
      );
      if (error) throw error;
      return (data ?? []) as unknown as LegalDocumentSearchResult[];
    },
  });
}
