import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface GeneratedDocument {
  id: string;
  order_id: string;
  profile_id: string;
  document_type: string;
  document_number: string;
  document_date: string;
  file_path: string | null;
  file_url: string | null;
  executor_id: string | null;
  executor_snapshot: Record<string, unknown>;
  client_details_id: string | null;
  client_snapshot: Record<string, unknown>;
  order_snapshot: Record<string, unknown>;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  sent_to_email: string | null;
  sent_to_telegram: string | null;
  download_count: number;
  last_downloaded_at: string | null;
  rule_id: string | null;
  template_id: string | null;
  installment_payment_id: string | null;
  payer_type: string | null;
  payer_type_mismatch: boolean;
  mismatch_warning: string | null;
  generation_log: Record<string, unknown>;
  contract_number: string | null;
  contract_date: string | null;
  service_period_from: string | null;
  service_period_to: string | null;
  paid_amount: number | null;
  contract_total_amount: number | null;
  currency: string;
  trigger_type: string | null;
  created_at: string;
  updated_at: string;
  // Relations
  profile?: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
  order?: {
    id: string;
    order_number: string;
    final_price: number;
    status?: string;
    product?: { id: string; name: string } | null;
    tariff?: { id: string; name: string } | null;
  } | null;
  template?: {
    id: string;
    name: string;
    code: string;
  } | null;
}

export interface DocumentFilters {
  status?: string;
  document_type?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
  profile_id?: string;
  order_id?: string;
}

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  generated: 'Сгенерирован',
  sent: 'Отправлен',
  error: 'Ошибка',
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  invoice_act: 'Счёт-акт',
  act: 'Акт',
  contract: 'Договор',
};

export function useGeneratedDocuments(filters?: DocumentFilters) {
  return useQuery({
    queryKey: ["generated-documents", filters],
    queryFn: async () => {
      let query = supabase
        .from("generated_documents")
        .select(`
          *,
          profile:profiles(id, full_name, email),
          order:orders_v2(
            id, order_number, final_price, status,
            product:products_v2(id, name),
            tariff:tariffs(id, name)
          ),
          template:document_templates(id, name, code)
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (filters?.status) {
        query = query.eq("status", filters.status);
      }
      if (filters?.document_type) {
        query = query.eq("document_type", filters.document_type);
      }
      if (filters?.date_from) {
        query = query.gte("document_date", filters.date_from);
      }
      if (filters?.date_to) {
        query = query.lte("document_date", filters.date_to);
      }
      if (filters?.profile_id) {
        query = query.eq("profile_id", filters.profile_id);
      }
      if (filters?.order_id) {
        query = query.eq("order_id", filters.order_id);
      }
      if (filters?.search) {
        query = query.or(`document_number.ilike.%${filters.search}%,order_id.eq.${filters.search}`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as GeneratedDocument[];
    },
  });
}

export function useOrderDocuments(orderId?: string) {
  return useQuery({
    queryKey: ["order-documents", orderId],
    queryFn: async () => {
      if (!orderId) return [];
      
      const { data, error } = await supabase
        .from("generated_documents")
        .select(`
          *,
          template:document_templates(id, name, code)
        `)
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as GeneratedDocument[];
    },
    enabled: !!orderId,
  });
}

export function useUserDocuments(userId?: string) {
  return useQuery({
    queryKey: ["user-documents", userId],
    queryFn: async () => {
      if (!userId) return [];
      
      // First get profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", userId)
        .single();

      if (!profile) return [];
      
      const { data, error } = await supabase
        .from("generated_documents")
        .select(`
          *,
          order:orders_v2(id, order_number, final_price, product:products_v2(id, name))
        `)
        .eq("profile_id", profile.id)
        .in("status", ["generated", "sent"])
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as GeneratedDocument[];
    },
    enabled: !!userId,
  });
}

export function useResendDocument() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ documentId, sendEmail, sendTelegram }: { documentId: string; sendEmail?: boolean; sendTelegram?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("document-auto-generate", {
        body: {
          action: "resend",
          document_id: documentId,
          send_email: sendEmail,
          send_telegram: sendTelegram,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["generated-documents"] });
      toast.success("Документ отправлен повторно");
    },
    onError: (error) => {
      console.error("Resend error:", error);
      toast.error("Ошибка отправки документа");
    },
  });
}

export function useRegenerateDocument() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ orderId, templateId }: { orderId: string; templateId?: string }) => {
      const { data, error } = await supabase.functions.invoke("document-auto-generate", {
        body: {
          action: "regenerate",
          order_id: orderId,
          template_id: templateId,
          trigger: "manual",
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["generated-documents"] });
      toast.success("Документ перегенерирован");
    },
    onError: (error) => {
      console.error("Regenerate error:", error);
      toast.error("Ошибка генерации документа");
    },
  });
}

export function useDownloadDocument() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ documentId, filePath }: { documentId: string; filePath: string }) => {
      // Get signed URL
      const { data: signedUrl, error: signError } = await supabase.storage
        .from("documents")
        .createSignedUrl(filePath, 3600);

      if (signError) throw signError;

      // Update download count (increment manually)
      const { data: doc } = await supabase
        .from("generated_documents")
        .select("download_count")
        .eq("id", documentId)
        .single();

      await supabase
        .from("generated_documents")
        .update({
          download_count: (doc?.download_count || 0) + 1,
          last_downloaded_at: new Date().toISOString(),
        })
        .eq("id", documentId);

      return signedUrl.signedUrl;
    },
    onSuccess: (url) => {
      queryClient.invalidateQueries({ queryKey: ["generated-documents"] });
      window.open(url, "_blank");
    },
    onError: (error) => {
      console.error("Download error:", error);
      toast.error("Ошибка скачивания документа");
    },
  });
}
