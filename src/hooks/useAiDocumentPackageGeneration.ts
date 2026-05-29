/**
 * Hook for generating a package of documents via edge function.
 *
 * Sprint 3I-A-1 contract: the orchestrator accepts ONLY
 *   { package_session_id, run_mode? }
 * Everything else (template/items/legal entity/persons) is resolved
 * server-side from the package session. Per-item results are returned as
 * an aggregated batch; rendering itself is delegated to
 * canonical-document-generate-strict.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface PackageGenerationItemResult {
  item_id: string;
  template_id?: string;
  status: "generated" | "blocked" | "error" | "skipped";
  document_id?: string;
  document_number?: string;
  document_date?: string;
  download_url?: string;
  errors?: string[];
  details?: unknown;
}

export interface PackageGenerationResult {
  success: boolean;
  batch_id: string;
  status: "pending" | "generated" | "partial" | "failed" | "blocked";
  total: number;
  generated: number;
  blocked?: number;
  errors: number;
  results: PackageGenerationItemResult[];
}

export interface GeneratePackageParams {
  package_session_id: string;
  run_mode?: "user_generate" | "admin_test";
}

export function useAiDocumentPackageGeneration() {
  // useAuth currently unused but retained for future ownership UI hints.
  useAuth();
  const queryClient = useQueryClient();

  const generatePackage = useMutation({
    mutationFn: async (params: GeneratePackageParams) => {
      if (!params?.package_session_id) {
        throw new Error("package_session_id_required");
      }
      const { data, error } = await supabase.functions.invoke(
        "ai-generate-document-package",
        { body: params }
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as PackageGenerationResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-generated-documents"] });
      queryClient.invalidateQueries({ queryKey: ["ai-document-generation-batches"] });
      queryClient.invalidateQueries({ queryKey: ["ai-document-generation-batch-documents"] });
      if (data.status === "generated") {
        toast.success(`Пакет сформирован: ${data.generated} документ(ов)`);
      } else if (data.status === "partial") {
        toast.warning(`Пакет частично сформирован: ${data.generated} из ${data.total}`);
      } else {
        toast.error("Ошибка генерации пакета");
      }
    },
    onError: (error: Error) => {
      console.error("Package generation error:", error);
      toast.error(`Ошибка генерации пакета: ${error.message}`);
    },
  });

  return {
    generatePackage: generatePackage.mutateAsync,
    isGenerating: generatePackage.isPending,
  };
}
