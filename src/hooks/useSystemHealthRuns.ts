import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface SystemHealthRun {
  id: string;
  run_type: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  finished_at: string | null;
  summary: {
    total_checks?: number;
    passed?: number;
    failed?: number;
  } | null;
  meta: Record<string, any> | null;
}

export interface SystemHealthCheck {
  id: string;
  run_id: string;
  check_key: string;
  check_name: string;
  category: string;
  status: "passed" | "failed";
  count: number;
  sample_rows: any[];
  details: Record<string, any> | null;
  duration_ms: number | null;
  created_at: string;
}

export interface IgnoredCheck {
  id: string;
  check_key: string;
  ignored_by: string;
  reason: string;
  source: "manual" | "auto" | "migration";
  ignored_at: string;
  expires_at: string | null;
  created_at: string;
}

export function useSystemHealthRuns() {
  return useQuery({
    queryKey: ["system-health-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_health_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(30);

      if (error) throw error;
      return data as SystemHealthRun[];
    },
  });
}

export function useSystemHealthChecks(runId: string | null) {
  return useQuery({
    queryKey: ["system-health-checks", runId],
    queryFn: async () => {
      if (!runId) return [];
      
      const { data, error } = await supabase
        .from("system_health_checks")
        .select("*")
        .eq("run_id", runId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as SystemHealthCheck[];
    },
    enabled: !!runId,
  });
}

export function useLatestSystemHealth() {
  return useQuery({
    queryKey: ["system-health-latest"],
    queryFn: async () => {
      // Get latest completed or failed run (not running/aborted)
      const { data: run, error: runError } = await supabase
        .from("system_health_runs")
        .select("*")
        .in("status", ["completed", "failed"])
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (runError) throw runError;
      if (!run) return { run: null, checks: [] };

      // Get checks for this run
      const { data: checks, error: checksError } = await supabase
        .from("system_health_checks")
        .select("*")
        .eq("run_id", run.id)
        .order("created_at", { ascending: true });

      if (checksError) throw checksError;

      return { 
        run: run as SystemHealthRun, 
        checks: checks as SystemHealthCheck[] 
      };
    },
  });
}

export function useTriggerHealthCheck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("nightly-system-health", {
        body: { source: "manual", notify_owner: false },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Проверка запущена");
      // Refetch runs after a delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["system-health-runs"] });
        queryClient.invalidateQueries({ queryKey: ["system-health-latest"] });
      }, 3000);
    },
    onError: (error) => {
      toast.error("Ошибка запуска проверки", {
        description: String(error),
      });
    },
  });
}

// ============ IGNORED CHECKS ============

export function useIgnoredChecks() {
  return useQuery({
    queryKey: ["system-health-ignored"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_health_ignored_checks")
        .select("*")
        .or("expires_at.is.null,expires_at.gt.now()");
      
      if (error) {
        // If user doesn't have access (not super_admin), return empty array
        if (error.code === "42501" || error.message.includes("permission")) {
          return [];
        }
        throw error;
      }
      return data as IgnoredCheck[];
    },
  });
}

export function useIgnoreCheck() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      checkKey, 
      reason, 
      expiresAt 
    }: { 
      checkKey: string; 
      reason: string; 
      expiresAt?: Date | null;
    }) => {
      const { error } = await supabase
        .from("system_health_ignored_checks")
        .insert({ 
          check_key: checkKey, 
          reason,
          expires_at: expiresAt?.toISOString() || null,
          source: "manual"
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-health-ignored"] });
      toast.success("Проверка добавлена в игнорируемые");
    },
    onError: (error) => {
      toast.error("Ошибка", { description: String(error) });
    },
  });
}

export function useUnignoreCheck() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("system_health_ignored_checks")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-health-ignored"] });
      toast.success("Игнорирование отменено");
    },
    onError: (error) => {
      toast.error("Ошибка", { description: String(error) });
    },
  });
}

// Category labels in Russian
export const CATEGORY_LABELS: Record<string, string> = {
  payments: "Платежи",
  access: "Доступы",
  telegram: "Telegram",
  system: "Система",
  integrations: "Интеграции",
  content: "Контент",
};

// Invariant code to full translation
export const INVARIANT_INFO: Record<string, {
  title: string;
  explain: string;
  action: string;
  urlTemplate?: string;
  category: string;
}> = {
  "INV-1": {
    title: "Дубликаты платежей",
    explain: "Найдены платежи с одинаковым ID от провайдера",
    action: "Удалить дубликаты в админке платежей",
    urlTemplate: "/admin/payments?duplicate=true",
    category: "payments",
  },
  "INV-2A": {
    title: "Платежи без заказов",
    explain: "Деньги пришли, но заказ не создан (потеря учёта)",
    action: "Создать заказы или переклассифицировать как тестовые",
    urlTemplate: "/admin/payments?filter=orphan",
    category: "payments",
  },
  "INV-2B": {
    title: "Технические сироты",
    explain: "Технические платежи без привязки (мониторинг)",
    action: "Проверить рост количества",
    urlTemplate: "/admin/payments?classification=orphan_technical",
    category: "payments",
  },
  "INV-2B-WARN": {
    title: "Порог технических сирот",
    explain: "Количество превысило порог (200)",
    action: "Исследовать причину роста",
    urlTemplate: "/admin/payments?classification=orphan_technical",
    category: "system",
  },
  "INV-3": {
    title: "Несовпадение сумм",
    explain: "Сумма платежа отличается от суммы заказа",
    action: "Проверить скидки или исправить данные",
    urlTemplate: "/admin/payments?id={payment_id}",
    category: "payments",
  },
  "INV-4": {
    title: "Триал-блокировки (24ч)",
    explain: "Статистика триал-блокировок и защиты сумм",
    action: "Информационно",
    category: "system",
  },
  "INV-5": {
    title: "Несколько цен на тарифе",
    explain: "Один тариф имеет несколько активных цен",
    action: "Деактивировать лишние цены",
    urlTemplate: "/admin/products-v2/{product_id}",
    category: "system",
  },
  "INV-6": {
    title: "Расчёты списаний (7д)",
    explain: "Статистика расчётов списаний за неделю",
    action: "Информационно",
    category: "system",
  },
  "INV-7": {
    title: "Рассинхрон с bePaid",
    explain: "Сумма в базе не совпадает с данными bePaid",
    action: "Запустить синхронизацию с выпиской",
    urlTemplate: "/admin/payments?tab=statement",
    category: "payments",
  },
  "INV-8": {
    title: "Нет классификации",
    explain: "Платежи 2026+ без категории",
    action: "Запустить автоклассификацию",
    urlTemplate: "/admin/payments?filter=unclassified",
    category: "payments",
  },
  "INV-9": {
    title: "Верификации с заказами",
    explain: "Проверки карт ошибочно создали заказы",
    action: "Удалить лишние заказы",
    category: "payments",
  },
  "INV-10": {
    title: "Просроченные доступы",
    explain: "Активные entitlements с истёкшим сроком",
    action: "Запустить очистку доступов",
    urlTemplate: "/admin/entitlements?filter=expired",
    category: "access",
  },
  "INV-11": {
    title: "Просроченные подписки",
    explain: "Активные подписки с истёкшим сроком",
    action: "Запустить очистку подписок",
    urlTemplate: "/admin/subscriptions-v2?filter=expired",
    category: "access",
  },
  "INV-12": {
    title: "Ошибочные ревоки TG",
    explain: "Пользователи с доступом исключены из групп",
    action: "Восстановить членство в Telegram",
    urlTemplate: "/admin/telegram-diagnostics",
    category: "telegram",
  },
  "INV-13": {
    title: "Триалы без доступа",
    explain: "Оплаченный триал не создал доступ",
    action: "Проверить создание подписок",
    urlTemplate: "/admin/deals?filter=trial",
    category: "access",
  },
  "INV-14": {
    title: "Двойные подписки",
    explain: "Один пользователь имеет несколько активных подписок",
    action: "Объединить или деактивировать лишние",
    category: "access",
  },
  "INV-15": {
    title: "Платежи без профиля",
    explain: "Успешный платёж не привязан к профилю",
    action: "Найти и привязать профиль",
    category: "payments",
  },
};
