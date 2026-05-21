/**
 * useOrderCanonicalDocuments — канонические сгенерированные документы
 * для конкретного заказа.
 *
 * SOT: таблица `ai_generated_documents` (то, что пишет
 * `canonical-document-generate-strict`). Фильтр — `context_type='order' AND
 * context_id=order_id`. Legacy таблица `generated_documents` НЕ используется
 * для пользовательского UI «Мои покупки».
 *
 * Возвращает только живые документы (status='generated' или legacy 'success',
 * deleted_at IS NULL, file_path NOT NULL) — чтобы не показывать половинчатые/неуспешные.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CanonicalDocument {
  id: string;
  title: string;
  document_number: string | null;
  document_date: string | null;
  file_path: string | null;
  file_name: string | null;
  file_mime: string | null;
  storage_bucket: string;
  status: string;
  template_id: string | null;
  template_name: string | null;
  created_at: string;
  meta: Record<string, any> | null;
}

export function useOrderCanonicalDocuments(orderId?: string | null) {
  return useQuery({
    queryKey: ["canonical-documents", "order", orderId],
    queryFn: async (): Promise<CanonicalDocument[]> => {
      if (!orderId) return [];
      const { data, error } = await supabase
        .from("ai_generated_documents")
        .select(
          "id, title, document_number, document_date, file_path, file_name, file_mime, storage_bucket, status, template_id, template_name, created_at, meta",
        )
        .eq("context_type", "order")
        .eq("context_id", orderId)
        .is("deleted_at", null)
        .in("status", ["generated", "success"])
        .not("file_path", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as CanonicalDocument[];
    },
    enabled: !!orderId,
    staleTime: 30_000,
  });
}
