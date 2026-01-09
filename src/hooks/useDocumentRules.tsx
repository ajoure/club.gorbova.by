import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface DocumentGenerationRule {
  id: string;
  name: string;
  description: string | null;
  product_id: string | null;
  tariff_id: string | null;
  offer_id: string | null;
  trigger_type: 'payment_success' | 'trial_started' | 'installment_payment' | 'installment_first' | 'installment_last' | 'manual';
  template_id: string;
  field_overrides: Record<string, unknown>;
  auto_send_email: boolean;
  auto_send_telegram: boolean;
  payer_type_filter: string[] | null;
  min_amount: number | null;
  max_amount: number | null;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Relations
  template?: {
    id: string;
    name: string;
    code: string;
    document_type: string;
  };
  product?: {
    id: string;
    name: string;
  };
  tariff?: {
    id: string;
    name: string;
  };
}

export const TRIGGER_TYPE_LABELS: Record<string, string> = {
  payment_success: 'Успешная оплата',
  trial_started: 'Начало триала',
  installment_payment: 'Платёж по рассрочке',
  installment_first: 'Первый платёж рассрочки',
  installment_last: 'Последний платёж рассрочки',
  manual: 'Ручная генерация',
};

export const PAYER_TYPE_OPTIONS = [
  { value: 'individual', label: 'Физическое лицо' },
  { value: 'entrepreneur', label: 'ИП' },
  { value: 'legal_entity', label: 'Юридическое лицо' },
];

export function useDocumentRules() {
  const queryClient = useQueryClient();

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["document-generation-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_generation_rules")
        .select(`
          *,
          template:document_templates(id, name, code, document_type),
          product:products_v2(id, name),
          tariff:tariffs(id, name)
        `)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as DocumentGenerationRule[];
    },
  });

  const createRule = useMutation({
    mutationFn: async (rule: Record<string, unknown>) => {
      const { data, error } = await supabase
        .from("document_generation_rules")
        .insert(rule as any)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-generation-rules"] });
      toast.success("Правило создано");
    },
    onError: (error) => {
      console.error("Create rule error:", error);
      toast.error("Ошибка создания правила");
    },
  });

  const updateRule = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Record<string, unknown>) => {
      const { data, error } = await supabase
        .from("document_generation_rules")
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-generation-rules"] });
      toast.success("Правило обновлено");
    },
    onError: (error) => {
      console.error("Update rule error:", error);
      toast.error("Ошибка обновления правила");
    },
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("document_generation_rules")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-generation-rules"] });
      toast.success("Правило удалено");
    },
    onError: (error) => {
      console.error("Delete rule error:", error);
      toast.error("Ошибка удаления правила");
    },
  });

  return {
    rules,
    isLoading,
    createRule: createRule.mutateAsync,
    updateRule: updateRule.mutateAsync,
    deleteRule: deleteRule.mutateAsync,
    isCreating: createRule.isPending,
    isUpdating: updateRule.isPending,
    isDeleting: deleteRule.isPending,
  };
}

export function useDocumentRulesForTariff(tariffId?: string) {
  return useQuery({
    queryKey: ["document-rules-for-tariff", tariffId],
    queryFn: async () => {
      if (!tariffId) return [];
      
      const { data, error } = await supabase
        .from("document_generation_rules")
        .select(`
          *,
          template:document_templates(id, name, code, document_type)
        `)
        .eq("tariff_id", tariffId)
        .eq("is_active", true)
        .order("priority", { ascending: false });

      if (error) throw error;
      return data as DocumentGenerationRule[];
    },
    enabled: !!tariffId,
  });
}
