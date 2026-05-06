/**
 * useAiDocuments — CRUD hook for AI-generated documents.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface AiGeneratedDocument {
  id: string;
  profile_id: string;
  template_id: string | null;
  template_name: string;
  template_source_path: string | null;
  title: string;
  status: string;
  legal_details_id: string | null;
  person_id: string | null;
  signer_person_id: string | null;
  signer_link_id: string | null;
  file_path: string | null;
  file_name: string | null;
  file_mime: string | null;
  storage_bucket: string;
  snapshot: Record<string, unknown>;
  missing_tokens: string[];
  meta: Record<string, unknown>;
  generation_error: string | null;
  generation_batch_id: string | null;
  package_template_id: string | null;
  package_item_id: string | null;
  batch: { title: string } | null;
  deleted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // canonical pipeline (Sprint 1+)
  template_version_id?: string | null;
  template_version?: number | string | null;
  context_type?: string | null;
  context_id?: string | null;
  idempotency_key?: string | null;
  regenerated_from_document_id?: string | null;
  source_trace?: Record<string, any> | null;
  token_manifest_snapshot?: any[] | null;
  template_tokens_snapshot?: string[] | null;
  warnings_snapshot?: string[] | null;
  registry_version?: string | null;
  resolver_version?: string | null;
}

export function useAiDocuments() {
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

  // Query generated documents (exclude soft-deleted)
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["ai-generated-documents", profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const { data, error } = await supabase
        .from("ai_generated_documents")
        .select("*, batch:ai_document_generation_batches!ai_generated_documents_generation_batch_id_fkey(title)")
        .eq("profile_id", profileId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AiGeneratedDocument[];
    },
    enabled: !!profileId,
  });

  // Generate document via edge function
  const generateMutation = useMutation({
    mutationFn: async (params: {
      template_id: string;
      legal_details_id?: string;
      person_id?: string;
      signer_link_id?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("ai-generate-document", {
        body: params,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as {
        success: boolean;
        document_id: string;
        document_number: string;
        download_url: string;
        missing_tokens: string[];
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-generated-documents", profileId] });
      toast.success("Документ сформирован");
    },
    onError: (error: Error) => {
      console.error("Generate document error:", error);
      toast.error(`Ошибка генерации: ${error.message}`);
    },
  });

  // Download signed URL
  const getDownloadUrl = async (filePath: string, bucket = "documents"): Promise<string | null> => {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, 3600);
    if (error) {
      console.error("Signed URL error:", error);
      toast.error("Не удалось получить ссылку для скачивания");
      return null;
    }
    return data.signedUrl;
  };

  // Hard delete document + file
  const deleteMutation = useMutation({
    mutationFn: async (doc: AiGeneratedDocument) => {
      // Delete file from storage if exists
      if (doc.file_path) {
        await supabase.storage.from(doc.storage_bucket).remove([doc.file_path]);
      }
      const { error } = await supabase
        .from("ai_generated_documents")
        .delete()
        .eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-generated-documents", profileId] });
      toast.success("Документ удалён");
    },
    onError: (error: Error) => {
      console.error("Delete document error:", error);
      toast.error("Ошибка удаления документа");
    },
  });

  return {
    documents,
    isLoading,
    profileId,
    generate: generateMutation.mutateAsync,
    isGenerating: generateMutation.isPending,
    deleteDocument: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    getDownloadUrl,
  };
}
