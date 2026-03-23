/**
 * Hook for generating a package of documents via edge function.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface PackageGenerationResult {
  success: boolean;
  batch_id: string;
  batch_number: string;
  status: string;
  total: number;
  generated: number;
  errors: number;
  results: Array<{
    item_id: string;
    document_id?: string;
    document_number?: string;
    download_url?: string;
    error?: string;
    status: string;
  }>;
}

export function useAiDocumentPackageGeneration() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const generatePackage = useMutation({
    mutationFn: async (params: {
      package_template_id: string;
      legal_details_id?: string;
      person_id?: string;
      signer_link_id?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        "ai-generate-document-package",
        { body: params }
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as PackageGenerationResult;
    },
    onSuccess: (data) => {
      // Invalidate documents history
      queryClient.invalidateQueries({ queryKey: ["ai-generated-documents"] });
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
