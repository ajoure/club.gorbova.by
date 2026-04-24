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
  is_ignored?: boolean;
  ignored_reason?: string | null;
}

async function fetchActiveIgnoredKeys(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("system_health_ignored_checks")
    .select("check_key, reason, expires_at");
  if (error || !data) return new Map();
  const now = Date.now();
  const map = new Map<string, string>();
  for (const row of data) {
    const exp = row.expires_at ? new Date(row.expires_at).getTime() : null;
    if (exp === null || exp > now) {
      map.set(row.check_key, row.reason || "");
    }
  }
  return map;
}

function annotateChecks(
  checks: SystemHealthCheck[],
  ignoredMap: Map<string, string>
): SystemHealthCheck[] {
  return checks.map((c) => {
    if (c.status === "failed" && ignoredMap.has(c.check_key)) {
      return { ...c, is_ignored: true, ignored_reason: ignoredMap.get(c.check_key) ?? null };
    }
    return c;
  });
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
      
      const [{ data, error }, ignoredMap] = await Promise.all([
        supabase
          .from("system_health_checks")
          .select("*")
          .eq("run_id", runId)
          .order("created_at", { ascending: true }),
        fetchActiveIgnoredKeys(),
      ]);

      if (error) throw error;
      return annotateChecks((data || []) as SystemHealthCheck[], ignoredMap);
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
  actionFn?: string;
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
    urlTemplate: "/admin/payments?filter=verification_orders",
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
    urlTemplate: "/admin/payments/auto-renewals?filter=expired_reentry",
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
    urlTemplate: "/admin/payments/auto-renewals",
    category: "access",
  },
  "INV-15": {
    title: "Платежи без профиля",
    explain: "Успешный платёж не привязан к профилю",
    action: "Найти и привязать профиль",
    urlTemplate: "/admin/payments?filter=no_profile",
    category: "payments",
  },
  "INV-16": {
    title: "Готовность к списанию (24ч)",
    explain: "Подписки к списанию в ближайшие 24ч с проблемами оплаты (нет карты, PM неактивен, нет токена)",
    action: "Привязать карту или пересоздать платёжный метод",
    urlTemplate: "/admin/payments/auto-renewals?filter=no_card",
    category: "payments",
  },
  "INV-17": {
    title: "Pending подписки BePaid",
    explain: "Подписки sbs_* в статусе pending/failed без синхронизации с bePaid API",
    action: "Запустить синхронизацию pending подписок",
    urlTemplate: "/admin/payments/bepaid-subscriptions",
    actionFn: "admin-bepaid-sync-pending",
    category: "integrations",
  },
  "INV-18": {
    title: "Необработанные orphans (24ч)",
    explain: "Webhook-события без привязки к заказу/платежу за последние сутки",
    action: "Проверить причины в orphans",
    urlTemplate: "/admin/payments?tab=diagnostics",
    category: "payments",
  },
  "INV-19A": {
    title: "BePaid sbs_* не в provider_subscriptions",
    explain: "ID подписок BePaid найдены в платежах/заказах, но отсутствуют в таблице provider_subscriptions",
    action: "Запустить admin-bepaid-backfill",
    urlTemplate: "/admin/payments/bepaid-subscriptions",
    category: "integrations",
  },
  "INV-19B": {
    title: "Token recurring без provider_subscriptions",
    explain: "Активные подписки с auto_renew без записи провайдера",
    action: "Запустить admin-bepaid-backfill",
    urlTemplate: "/admin/payments/bepaid-subscriptions",
    category: "integrations",
  },
  "INV-20": {
    title: "Оплаченные заказы без платежей",
    explain: "Заказы со статусом paid, но без записи в payments_v2",
    action: "Запустить admin-repair-missing-payments",
    urlTemplate: "/admin/payments?filter=orphan_orders",
    category: "payments",
  },
};
