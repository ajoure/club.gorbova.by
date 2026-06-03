import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export type IntegrationCategory = "crm" | "payments" | "email" | "telegram" | "socials" | "other";
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
  config_secrets?: Record<string, unknown>;
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
  advancedFields?: ProviderField[];
  description?: string;
  /**
   * Список ключей полей, которые должны храниться в integration_instances.config_secrets
   * (encrypted-at-rest канал) вместо публичного config jsonb.
   * Если не задано — все поля идут в config (legacy behaviour).
   */
  secretFieldKeys?: string[];
}

export interface ProviderField {
  key: string;
  label: string;
  type:
    | "text"
    | "password"
    | "email"
    | "url"
    | "select"
    | "checkbox"
    | "textarea"
    | "manychat_page_select"
    | "hidden";
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
      { key: "integration_id", label: "ID интеграции", type: "text", required: true, placeholder: "feeb6cbd-8571-4db5-bbf6-4d112d213c8b" },
      { key: "secret_key", label: "Секретный ключ", type: "text", required: true },
      { key: "long_term_token", label: "Долгосрочный токен", type: "text", required: false },
      { key: "auth_code", label: "Код авторизации (действителен 20 минут)", type: "text", required: false },
    ],
  },
  {
    id: "getcourse",
    name: "GetCourse",
    icon: "GraduationCap",
    category: "crm",
    description: "Платформа для онлайн-школ",
    fields: [
      { key: "account_name", label: "Имя аккаунта", type: "text", required: true, placeholder: "myschool (без .getcourse.ru)" },
      { key: "secret_key", label: "Секретный ключ API", type: "text", required: true },
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
      { key: "secret_key", label: "Секретный ключ API", type: "password", required: true },
      { key: "public_key", label: "Публичный ключ (для вебхуков)", type: "textarea", required: false, placeholder: "Опционально - только если стандартный ключ bePaid не работает" },
      { key: "test_mode", label: "Тестовый режим", type: "checkbox" },
      { key: "success_url", label: "URL успешной оплаты", type: "url", placeholder: "/dashboard?payment=success" },
      { key: "fail_url", label: "URL неудачной оплаты", type: "url", placeholder: "/pricing?payment=failed" },
    ],
  },
  {
    // UI-only entry: selection routes to StripeConnectionDialog
    // (see AddIntegrationDialog onSelectStripe). No generic config fields.
    id: "stripe",
    name: "Stripe",
    icon: "CreditCard",
    category: "payments",
    description: "Stripe Checkout (sandbox)",
    fields: [],
  },
  {
    id: "smtp",
    name: "SMTP",
    icon: "Mail",
    category: "email",
    description: "SMTP-сервер для отправки почты",
    fields: [
      { key: "email", label: "Email", type: "email", required: true, autoDetect: true },
      { key: "smtp_password", label: "Пароль приложения", type: "password", required: true },
    ],
    advancedFields: [
      { key: "from_name", label: "Имя отправителя", type: "text", placeholder: "Gorbova Club" },
      { key: "from_email", label: "Email отправителя", type: "email", placeholder: "noreply@example.com" },
      { key: "smtp_host", label: "SMTP хост", type: "text", placeholder: "smtp.gmail.com" },
      { key: "smtp_port", label: "SMTP порт", type: "text", placeholder: "465" },
      { 
        key: "smtp_encryption", 
        label: "Шифрование", 
        type: "select", 
        options: [
          { value: "SSL", label: "SSL (порт 465)" },
          { value: "TLS", label: "STARTTLS (порт 587)" },
        ] 
      },
    ],
  },
  {
    id: "hosterby",
    name: "hoster.by Cloud",
    icon: "Server",
    category: "other",
    description: "Белорусский VPS-хостинг. BY-egress для парсинга BY/RU сайтов.",
    fields: [
      { key: "cloud_access_key", label: "Cloud Access Key", type: "password", required: true },
      { key: "cloud_secret_key", label: "Cloud Secret Key", type: "password", required: true },
    ],
    advancedFields: [
      { key: "dns_access_key", label: "DNS Access Key (future)", type: "password" },
      { key: "dns_secret_key", label: "DNS Secret Key (future)", type: "password" },
    ],
  },
  {
    id: "kinescope",
    name: "Kinescope",
    icon: "Video",
    category: "other",
    description: "Видеохостинг для онлайн-курсов",
    fields: [
      { key: "api_token", label: "API Токен", type: "password", required: true, placeholder: "Токен из личного кабинета Kinescope" },
    ],
    advancedFields: [
      { key: "default_project_id", label: "Проект по умолчанию", type: "text", placeholder: "ID проекта" },
      { 
        key: "privacy_type", 
        label: "Приватность видео по умолчанию", 
        type: "select", 
        options: [
          { value: "anywhere", label: "Доступно везде" },
          { value: "custom", label: "Только на указанных доменах" },
          { value: "nowhere", label: "Недоступно нигде" },
        ] 
      },
      { key: "privacy_domains", label: "Разрешённые домены", type: "textarea", placeholder: "gorbova.com\nschool.gorbova.com" },
    ],
  },
  {
    id: "apix_instagram_dm",
    name: "Instagram (ApiX-Drive)",
    icon: "Instagram",
    category: "socials",
    description: "Двусторонний обмен сообщениями Instagram Direct через ApiX-Drive",
    fields: [
      { key: "webhook_secret", label: "Webhook Secret", type: "password", required: true, placeholder: "Секрет для валидации вебхуков" },
      { key: "apix_api_key", label: "API-ключ ApiX-Drive", type: "password", required: false, placeholder: "Для отправки ответов" },
      { key: "account_name", label: "Имя аккаунта Instagram", type: "text", required: false, placeholder: "@username" },
    ],
  },
  {
    id: "manychat",
    name: "ManyChat (Instagram)",
    icon: "MessageCircle",
    category: "socials",
    description: "Instagram Direct через ManyChat Public API + External Request",
    secretFieldKeys: ["api_key", "workspace_token"],
    fields: [
      { key: "api_key", label: "API Key (ManyChat)", type: "password", required: true, placeholder: "Bearer токен Public API" },
      { key: "manychat_page_id", label: "Страница ManyChat", type: "manychat_page_select", required: false, placeholder: "Получите страницу по API Key" },
      { key: "manychat_page_name", label: "Название страницы", type: "hidden", required: false },
      { key: "workspace_token", label: "Workspace Token", type: "password", required: false, placeholder: "Опционально — генерируется backend" },
      { key: "allowed_page_ids", label: "Дополнительные Page ID (whitelist)", type: "textarea", required: false, placeholder: "Один ID на строку" },
    ],
  },
  {
    id: "facebook",
    name: "Facebook (скоро)",
    icon: "Facebook",
    category: "socials",
    description: "Скоро",
    fields: [],
  },
];

export const CATEGORIES: { id: IntegrationCategory; label: string; icon: string }[] = [
  { id: "crm", label: "CRM", icon: "Link2" },
  { id: "payments", label: "Платежи", icon: "CreditCard" },
  { id: "email", label: "Почта", icon: "Mail" },
  { id: "telegram", label: "Telegram", icon: "Send" },
  { id: "socials", label: "Соцсети", icon: "Share2" },
  { id: "other", label: "Разное", icon: "Settings" },
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

/**
 * Разделяет плоский набор полей формы на (config, config_secrets) согласно
 * provider.secretFieldKeys. Если provider не задаёт secretFieldKeys — всё
 * попадает в config (legacy behaviour, ничего не ломаем).
 */
export function splitConfigBySecrets(
  providerId: string,
  fields: Record<string, unknown>,
): { config: Record<string, unknown>; config_secrets: Record<string, unknown> } {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  const secretKeys = new Set(provider?.secretFieldKeys ?? []);
  const config: Record<string, unknown> = {};
  const config_secrets: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (secretKeys.has(key)) config_secrets[key] = value;
    else config[key] = value;
  }
  return { config, config_secrets };
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
      // Per-provider routing: secret fields → config_secrets, остальные → config
      const { config, config_secrets } = splitConfigBySecrets(data.provider, data.config);

      const { data: result, error } = await supabase
        .from("integration_instances")
        .insert({
          category: data.category,
          provider: data.provider,
          alias: data.alias,
          is_default: data.is_default,
          status: data.status,
          config: config as Json,
          config_secrets: config_secrets as Json,
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
    mutationFn: async ({ id, ...data }: {
      id: string;
      provider?: string;
      alias?: string;
      is_default?: boolean;
      config?: Record<string, unknown>;
      status?: string;
      error_message?: string | null;
    }) => {
      const updateData: Record<string, unknown> = {};
      if (data.alias !== undefined) updateData.alias = data.alias;
      if (data.is_default !== undefined) updateData.is_default = data.is_default;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.error_message !== undefined) updateData.error_message = data.error_message;

      // Если переданы поля config — расщепляем по provider.secretFieldKeys.
      // provider обязателен для корректного routing; если не передан — пишем
      // всё в config (legacy fallback) чтобы не ломать существующие вызовы.
      if (data.config !== undefined) {
        if (data.provider) {
          const { config, config_secrets } = splitConfigBySecrets(data.provider, data.config);
          updateData.config = config as Json;
          // config_secrets обновляется только если в split что-то попало.
          // EditIntegrationDialog отфильтровывает пустые секреты (PATCH-MIT),
          // поэтому отсутствие ключа = «не менять секрет».
          if (Object.keys(config_secrets).length > 0) {
            // Merge с существующими: читаем текущее значение и накатываем сверху.
            const { data: existing } = await supabase
              .from("integration_instances")
              .select("config_secrets")
              .eq("id", id)
              .single();
            const merged = {
              ...((existing?.config_secrets as Record<string, unknown>) || {}),
              ...config_secrets,
            };
            updateData.config_secrets = merged as Json;
          }
        } else {
          updateData.config = data.config as Json;
        }
      }

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
