/**
 * useCorporatePackageGeneration — Hook for invoking corporate DOCX generation.
 * Sprint 3: Calls ai-generate-corporate-package edge function.
 * 
 * Status flow: frontend shows local loading state, but does NOT set session status.
 * The edge function is the source of truth for confirmed → generating → generated.
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface GenerationResult {
  success: boolean;
  batch_id?: string;
  batch_number?: string;
  status?: string;
  total_eligible?: number;
  generated?: number;
  errors?: number;
  pre_flight_issues?: string[];
  results?: Array<{
    template_code: string;
    title: string;
    document_id?: string;
    document_number?: string;
    download_url?: string;
    status: 'generated' | 'error' | 'skipped';
    error?: string;
  }>;
  error?: string;
}

export function useCorporatePackageGeneration() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);

  const generateCorporatePackage = useCallback(async (
    corporateDraftSessionId: string
  ): Promise<GenerationResult> => {
    setIsGenerating(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke(
        'ai-generate-corporate-package',
        {
          body: { corporate_draft_session_id: corporateDraftSessionId },
        }
      );

      if (error) {
        const errorResult: GenerationResult = {
          success: false,
          error: error.message || 'Generation failed',
        };
        setResult(errorResult);
        toast.error('Ошибка генерации: ' + (error.message || 'Неизвестная ошибка'));
        return errorResult;
      }

      const genResult = data as GenerationResult;
      setResult(genResult);

      if (genResult.success) {
        toast.success(`Пакет сгенерирован: ${genResult.generated} из ${genResult.total_eligible} документов`);
      } else {
        toast.error(genResult.error || 'Генерация завершилась с ошибками');
      }

      return genResult;
    } catch (err: unknown) {
      const errorResult: GenerationResult = {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
      setResult(errorResult);
      toast.error('Ошибка генерации');
      return errorResult;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return {
    generateCorporatePackage,
    isGenerating,
    result,
  };
}
