import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface DocumentTemplate {
  id: string;
  name: string;
  code: string;
  description: string | null;
  document_type: string;
  template_path: string;
  placeholders: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductDocumentTemplate {
  id: string;
  product_id: string;
  template_id: string;
  auto_generate: boolean;
  auto_send_email: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  template?: DocumentTemplate;
}

// Стандартные плейсхолдеры для счёт-акта
export const INVOICE_ACT_PLACEHOLDERS = [
  { key: "{{document_number}}", description: "Номер документа" },
  { key: "{{document_date}}", description: "Дата документа" },
  { key: "{{executor_name}}", description: "Наименование исполнителя" },
  { key: "{{executor_short_name}}", description: "Краткое наименование исполнителя" },
  { key: "{{executor_unp}}", description: "УНП исполнителя" },
  { key: "{{executor_address}}", description: "Адрес исполнителя" },
  { key: "{{executor_bank}}", description: "Банк исполнителя" },
  { key: "{{executor_bank_code}}", description: "БИК банка исполнителя" },
  { key: "{{executor_account}}", description: "Расчётный счёт исполнителя" },
  { key: "{{executor_phone}}", description: "Телефон исполнителя" },
  { key: "{{executor_email}}", description: "Email исполнителя" },
  { key: "{{executor_director}}", description: "ФИО директора" },
  { key: "{{executor_director_short}}", description: "ФИО директора (кратко)" },
  { key: "{{executor_position}}", description: "Должность директора" },
  { key: "{{executor_basis}}", description: "Действует на основании" },
  { key: "{{client_name}}", description: "ФИО/Наименование заказчика" },
  { key: "{{client_address}}", description: "Адрес заказчика" },
  { key: "{{client_unp}}", description: "УНП заказчика (для ИП/ЮЛ)" },
  { key: "{{client_phone}}", description: "Телефон заказчика" },
  { key: "{{client_email}}", description: "Email заказчика" },
  { key: "{{client_passport}}", description: "Паспортные данные (для ФЛ)" },
  { key: "{{client_bank}}", description: "Банк заказчика" },
  { key: "{{client_account}}", description: "Расчётный счёт заказчика" },
  { key: "{{product_name}}", description: "Название продукта" },
  { key: "{{tariff_name}}", description: "Название тарифа" },
  { key: "{{order_number}}", description: "Номер заказа" },
  { key: "{{amount}}", description: "Сумма цифрами" },
  { key: "{{amount_words}}", description: "Сумма прописью" },
  { key: "{{currency}}", description: "Валюта" },
  { key: "{{service_description}}", description: "Описание услуги" },
];

export function useDocumentTemplates() {
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["document-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_templates")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as DocumentTemplate[];
    },
  });

  const createTemplate = useMutation({
    mutationFn: async (template: Omit<DocumentTemplate, "id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase
        .from("document_templates")
        .insert(template)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      toast.success("Шаблон создан");
    },
    onError: (error) => {
      console.error("Create template error:", error);
      toast.error("Ошибка создания шаблона");
    },
  });

  const updateTemplate = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<DocumentTemplate> & { id: string }) => {
      const { data, error } = await supabase
        .from("document_templates")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      toast.success("Шаблон обновлён");
    },
    onError: (error) => {
      console.error("Update template error:", error);
      toast.error("Ошибка обновления шаблона");
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("document_templates")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      toast.success("Шаблон удалён");
    },
    onError: (error) => {
      console.error("Delete template error:", error);
      toast.error("Ошибка удаления шаблона");
    },
  });

  const uploadTemplateFile = async (file: File, code: string): Promise<string> => {
    const fileName = `${code}_${Date.now()}.docx`;
    const filePath = `templates/${fileName}`;

    const { error } = await supabase.storage
      .from("documents-templates")
      .upload(filePath, file, { upsert: true });

    if (error) throw error;
    return filePath;
  };

  return {
    templates,
    isLoading,
    createTemplate: createTemplate.mutateAsync,
    updateTemplate: updateTemplate.mutateAsync,
    deleteTemplate: deleteTemplate.mutateAsync,
    uploadTemplateFile,
    isCreating: createTemplate.isPending,
    isUpdating: updateTemplate.isPending,
    isDeleting: deleteTemplate.isPending,
  };
}

export function useProductDocumentTemplates(productId?: string) {
  const queryClient = useQueryClient();

  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ["product-document-templates", productId],
    queryFn: async () => {
      if (!productId) return [];
      
      const { data, error } = await supabase
        .from("product_document_templates")
        .select(`
          *,
          template:document_templates(*)
        `)
        .eq("product_id", productId);

      if (error) throw error;
      return data as (ProductDocumentTemplate & { template: DocumentTemplate })[];
    },
    enabled: !!productId,
  });

  const addMapping = useMutation({
    mutationFn: async (mapping: Omit<ProductDocumentTemplate, "id" | "created_at" | "updated_at" | "template">) => {
      const { data, error } = await supabase
        .from("product_document_templates")
        .insert(mapping)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-document-templates", productId] });
      toast.success("Шаблон привязан к продукту");
    },
    onError: (error) => {
      console.error("Add mapping error:", error);
      toast.error("Ошибка привязки шаблона");
    },
  });

  const updateMapping = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProductDocumentTemplate> & { id: string }) => {
      const { data, error } = await supabase
        .from("product_document_templates")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-document-templates", productId] });
      toast.success("Настройки обновлены");
    },
  });

  const removeMapping = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("product_document_templates")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-document-templates", productId] });
      toast.success("Шаблон отвязан от продукта");
    },
  });

  return {
    mappings,
    isLoading,
    addMapping: addMapping.mutateAsync,
    updateMapping: updateMapping.mutateAsync,
    removeMapping: removeMapping.mutateAsync,
  };
}
