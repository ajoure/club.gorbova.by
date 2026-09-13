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
import { documentFunctionError, packageDocumentTotal } from '@/utils/documentFunctionError';

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
  total?: number;
  total_items?: number;
  total_documents?: number;
  generated: number;
  blocked?: number;
  errors: number;
  results: PackageGenerationItemResult[];
}

export interface GeneratePackageParams {
  package_session_id: string;
  /**
   * Sprint 3I-C: user_generate — дефолтный режим backend'а, поэтому в network
   * body НЕ передаётся (отправляем только `{ package_session_id }`).
   * admin_test — явно в body.
   */
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
      // Sprint 3I-C: для user_generate не передаём run_mode — оставляем дефолт.
      const body: Record<string, unknown> = {
        package_session_id: params.package_session_id,
      };
      if (params.run_mode && params.run_mode !== "user_generate") {
        body.run_mode = params.run_mode;
      }
      const { data, error } = await supabase.functions.invoke(
        "ai-generate-document-package",
        { body }
      );
      if (error || data?.error) throw await documentFunctionError(error, data);
      if (!data || !Array.isArray(data.results)) throw await documentFunctionError(null);
      return data as PackageGenerationResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-generated-documents"] });
      queryClient.invalidateQueries({ queryKey: ["ai-document-generation-batches"] });
      queryClient.invalidateQueries({ queryKey: ["ai-document-generation-batch-documents"] });
      if (data.status === "generated") {
        toast.success(`Пакет сформирован: ${data.generated} документ(ов)`);
      } else if (data.status === "partial") {
        toast.warning(`Пакет частично сформирован: ${data.generated} из ${packageDocumentTotal(data)}`);
      } else if (data.status === "blocked") {
        toast.error("Запуск заблокирован: проверьте состав, роли и анкеты пакета.");
      } else {
        toast.error("Не удалось сформировать пакет документов.");
      }
    },
    onError: async (error: Error) => {
      toast.error((await documentFunctionError(error)).message);
    },
  });

  return {
    generatePackage: generatePackage.mutateAsync,
    isGenerating: generatePackage.isPending,
  };
}
