import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export type IntegrationCategory = "crm" | "payments" | "email" | "other";
export type IntegrationStatus = "connected" | "error" | "disconnected";

export interface IntegrationInstance {
  id: string;
  category: IntegrationCategory;
  provider: string;
  alias: string;
  is_default: boolean;
  status: IntegrationStatus;
  last_check_at: string | null;
  config: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationLog {
  id: string;
  instance_id: string;
  event_type: string;
  payload_meta: Record<string, unknown>;
  result: "success" | "error" | "pending";
  error_message: string | null;
  created_at: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  icon: string;
  category: IntegrationCategory;
  fields: ProviderField[];
  description?: string;
}

export interface ProviderField {
  key: string;
  label: string;
  type: "text" | "password" | "email" | "url" | "select" | "checkbox";
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  autoDetect?: boolean;
}

// Конфигурация провайдеров
export const PROVIDERS: ProviderConfig[] = [
  {
    id: "amocrm",
    name: "amoCRM",
    icon: "Link2",
    category: "crm",
    description: "CRM для продаж и маркетинга",
    fields: [
      { key: "subdomain", label: "Субдомен", type: "text", required: true, placeholder: "mycompany" },
      { key: "access_token", label: "Access Token", type: "password", required: true },
    ],
  },
  {
    id: "getcourse",
    name: "GetCourse",
    icon: "GraduationCap",
    category: "crm",
    description: "Платформа для онлайн-школ",
    fields: [
      { key: "account_name", label: "Имя аккаунта", type: "text", required: true, placeholder: "myschool" },
      { key: "secret_key", label: "Секретный ключ API", type: "password", required: true },
    ],
  },
  {
    id: "bepaid",
    name: "bePaid",
    icon: "CreditCard",
    category: "payments",
    description: "Платежный шлюз bePaid",
    fields: [
      { key: "shop_id", label: "ID магазина", type: "text", required: true },
      { key: "secret_key", label: "Секретный ключ", type: "password", required: true },
      { key: "test_mode", label: "Тестовый режим", type: "checkbox" },
      { key: "success_url", label: "URL успешной оплаты", type: "url", placeholder: "/dashboard?payment=success" },
      { key: "fail_url", label: "URL неудачной оплаты", type: "url", placeholder: "/pricing?payment=failed" },
    ],
  },
  {
    id: "smtp",
    name: "SMTP",
    icon: "Mail",
    category: "email",
    description: "SMTP-сервер для отправки почты",
    fields: [
      { key: "email", label: "Email", type: "email", required: true, autoDetect: true },
      { key: "smtp_password", label: "Пароль SMTP", type: "password", required: true },
      { key: "smtp_host", label: "SMTP Host", type: "text", placeholder: "smtp.yandex.ru" },
      { key: "smtp_port", label: "SMTP Port", type: "text", placeholder: "465" },
      { key: "from_name", label: "Имя отправителя", type: "text", placeholder: "Gorbova Club" },
      { key: "from_email", label: "Email отправителя", type: "email", placeholder: "noreply@gorbova.by" },
    ],
  },
];

export const CATEGORIES: { id: IntegrationCategory; label: string; icon: string }[] = [
  { id: "crm", label: "CRM", icon: "Link2" },
  { id: "payments", label: "Платежи", icon: "CreditCard" },
  { id: "email", label: "Почта", icon: "Mail" },
];

export function useIntegrations(category?: IntegrationCategory) {
  return useQuery({
    queryKey: ["integration-instances", category],
    queryFn: async () => {
      let query = supabase
        .from("integration_instances")
        .select("*")
        .order("created_at", { ascending: false });

      if (category) {
        query = query.eq("category", category);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as IntegrationInstance[];
    },
  });
}

export function useIntegrationLogs(instanceId: string | null) {
  return useQuery({
    queryKey: ["integration-logs", instanceId],
    queryFn: async () => {
      if (!instanceId) return [];
      const { data, error } = await supabase
        .from("integration_logs")
        .select("*")
        .eq("instance_id", instanceId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as IntegrationLog[];
    },
    enabled: !!instanceId,
  });
}

export function useIntegrationMutations() {
  const queryClient = useQueryClient();

  const createInstance = useMutation({
    mutationFn: async (data: {
      category: string;
      provider: string;
      alias: string;
      is_default: boolean;
      status: string;
      config: Record<string, unknown>;
      error_message: string | null;
    }) => {
      const { data: result, error } = await supabase
        .from("integration_instances")
        .insert({
          category: data.category,
          provider: data.provider,
          alias: data.alias,
          is_default: data.is_default,
          status: data.status,
          config: data.config as Json,
          error_message: data.error_message,
        })
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration-instances"] });
      toast.success("Подключение создано");
    },
    onError: (error) => {
      toast.error("Ошибка создания: " + error.message);
    },
  });

  const updateInstance = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; alias?: string; is_default?: boolean; config?: Record<string, unknown>; status?: string; error_message?: string | null }) => {
      const updateData: Record<string, unknown> = {};
      if (data.alias !== undefined) updateData.alias = data.alias;
      if (data.is_default !== undefined) updateData.is_default = data.is_default;
      if (data.config !== undefined) updateData.config = data.config as Json;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.error_message !== undefined) updateData.error_message = data.error_message;
      
      const { data: result, error } = await supabase
        .from("integration_instances")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration-instances"] });
      toast.success("Подключение обновлено");
    },
    onError: (error) => {
      toast.error("Ошибка обновления: " + error.message);
    },
  });

  const deleteInstance = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("integration_instances").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration-instances"] });
      toast.success("Подключение удалено");
    },
    onError: (error) => {
      toast.error("Ошибка удаления: " + error.message);
    },
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("integration_instances")
        .update({ is_default: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration-instances"] });
      toast.success("Подключение по умолчанию обновлено");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  const addLog = useMutation({
    mutationFn: async (data: { instance_id: string; event_type: string; payload_meta: Record<string, unknown>; result: string; error_message?: string | null }) => {
      const { error } = await supabase.from("integration_logs").insert({
        instance_id: data.instance_id,
        event_type: data.event_type,
        payload_meta: data.payload_meta as Json,
        result: data.result,
        error_message: data.error_message || null,
      });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["integration-logs", variables.instance_id] });
    },
  });

  return { createInstance, updateInstance, deleteInstance, setDefault, addLog };
}

// Утилиты для автодетекта SMTP настроек
export function getSmtpSettings(email: string): { host: string; port: number; encryption: string } | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  const settings: Record<string, { host: string; port: number; encryption: string }> = {
    "yandex.ru": { host: "smtp.yandex.ru", port: 465, encryption: "SSL" },
    "yandex.com": { host: "smtp.yandex.ru", port: 465, encryption: "SSL" },
    "ya.ru": { host: "smtp.yandex.ru", port: 465, encryption: "SSL" },
    "gmail.com": { host: "smtp.gmail.com", port: 465, encryption: "SSL" },
    "mail.ru": { host: "smtp.mail.ru", port: 465, encryption: "SSL" },
    "outlook.com": { host: "smtp-mail.outlook.com", port: 587, encryption: "TLS" },
    "hotmail.com": { host: "smtp-mail.outlook.com", port: 587, encryption: "TLS" },
    "icloud.com": { host: "smtp.mail.me.com", port: 587, encryption: "TLS" },
  };

  // Check for Yandex 360 domains
  if (!settings[domain]) {
    return { host: "smtp.yandex.ru", port: 465, encryption: "SSL" };
  }

  return settings[domain] || null;
}
