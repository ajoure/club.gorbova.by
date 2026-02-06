import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export interface AutoFix {
  target: string;
  action: string;
  result: "success" | "failed";
  details?: string;
}

export interface SystemHealthReport {
  id: string;
  status: "OK" | "DEGRADED" | "CRITICAL";
  edge_functions_total: number;
  edge_functions_deployed: number;
  edge_functions_missing: string[];
  invariants_total: number;
  invariants_passed: number;
  invariants_failed: number;
  auto_fixes: AutoFix[];
  auto_fixes_count: number;
  report_json: Record<string, unknown>;
  source: string;
  duration_ms: number | null;
  telegram_notified: boolean;
  created_at: string;
}

export interface FullCheckResponse {
  status: "OK" | "DEGRADED" | "CRITICAL";
  project_ref: string;
  expected_project_ref: string;
  edge_functions: {
    total: number;
    deployed: number;
    missing: string[];
    results: Array<{
      name: string;
      exists: boolean;
      http_status: number | null;
      status: string;
      tier: string;
      category: string;
      auto_fix_policy: string;
      cors_ok?: boolean;
      error?: string;
    }>;
  };
  breakdown: {
    p0_missing: string[];
    p1_missing: string[];
    p2_missing: string[];
    cors_errors: string[];
  };
  invariants: {
    total: number;
    passed: number;
    failed: number;
    results: Array<{
      code: string;
      name: string;
      passed: boolean;
      count: number;
      severity: string;
      samples?: unknown[];
    }>;
  };
  auto_fixes: AutoFix[];
  duration_ms: number;
  timestamp: string;
}

// Helper to safely parse auto_fixes from DB
function parseAutoFixes(json: Json): AutoFix[] {
  if (!Array.isArray(json)) return [];
  return json.map((item) => ({
    target: String((item as Record<string, unknown>)?.target || ""),
    action: String((item as Record<string, unknown>)?.action || ""),
    result: ((item as Record<string, unknown>)?.result === "success" ? "success" : "failed") as "success" | "failed",
    details: (item as Record<string, unknown>)?.details ? String((item as Record<string, unknown>).details) : undefined,
  }));
}

export function useSystemHealthReports() {
  return useQuery({
    queryKey: ["system-health-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_health_reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) {
        if (error.code === "42501" || error.message.includes("permission")) {
          return [];
        }
        throw error;
      }
      
      return (data || []).map((row) => ({
        ...row,
        status: row.status as "OK" | "DEGRADED" | "CRITICAL",
        auto_fixes: parseAutoFixes(row.auto_fixes),
        report_json: (row.report_json || {}) as Record<string, unknown>,
      })) as SystemHealthReport[];
    },
  });
}

export function useLatestFullCheck() {
  return useQuery({
    queryKey: ["system-health-latest-full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_health_reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        if (error.code === "42501" || error.message.includes("permission")) {
          return null;
        }
        throw error;
      }
      
      if (!data) return null;
      
      return {
        ...data,
        status: data.status as "OK" | "DEGRADED" | "CRITICAL",
        auto_fixes: parseAutoFixes(data.auto_fixes),
        report_json: (data.report_json || {}) as Record<string, unknown>,
      } as SystemHealthReport;
    },
  });
}

export function useTriggerFullCheck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      try {
        const { data, error } = await supabase.functions.invoke("system-health-full-check", {
          body: { source: "manual" },
        });

        if (error) throw error;
        return data as FullCheckResponse;
      } catch (e) {
        // Distinguish network/timeout errors from business errors
        if (e instanceof Error && (
          e.message.includes("Load failed") || 
          e.message.includes("Failed to fetch") ||
          e.message.includes("network") ||
          e.message.includes("timeout")
        )) {
          throw new Error("Превышено время ожидания. Проверка может выполняться в фоне — обновите страницу через 30 секунд.");
        }
        throw e;
      }
    },
    onSuccess: (data) => {
      const statusMessages = {
        OK: "Система работает штатно",
        DEGRADED: "Обнаружены некритичные проблемы",
        CRITICAL: "Обнаружены критические проблемы!",
      };
      
      const statusVariants: Record<string, "success" | "warning" | "error"> = {
        OK: "success",
        DEGRADED: "warning",
        CRITICAL: "error",
      };

      toast[statusVariants[data.status] || "info"](
        `Полный чек: ${data.status}`,
        { description: statusMessages[data.status] }
      );

      queryClient.invalidateQueries({ queryKey: ["system-health-reports"] });
      queryClient.invalidateQueries({ queryKey: ["system-health-latest-full"] });
    },
    onError: (error) => {
      toast.error("Ошибка запуска проверки", {
        description: String(error.message || error),
      });
    },
  });
}

// Remediation types
export interface RemediationPlan {
  target: string;
  action: string;
  reason: string;
  auto_fix_policy: string;
  safe: boolean;
}

export interface RemediationResult {
  target: string;
  action: string;
  result: "success" | "failed" | "skipped";
  details?: string;
}

export interface RemediateResponse {
  mode: "dry-run" | "execute";
  plan: RemediationPlan[];
  executed: boolean;
  results: RemediationResult[];
  timestamp: string;
}

export interface RemediateResponseWithError extends RemediateResponse {
  error?: "forbidden" | "network";
}

export function useRemediate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mode: "dry-run" | "execute"): Promise<RemediateResponseWithError> => {
      try {
        const { data, error } = await supabase.functions.invoke("system-health-remediate", {
          body: { mode },
        });

        if (error) {
          // 403/Forbidden is a business error, not crash
          if (error.message?.includes("403") || error.message?.includes("Forbidden") || error.message?.includes("forbidden")) {
            return {
              mode,
              plan: [],
              executed: false,
              results: [],
              timestamp: new Date().toISOString(),
              error: "forbidden",
            };
          }
          throw error;
        }
        return data as RemediateResponseWithError;
      } catch (e) {
        // Network/timeout errors
        if (e instanceof Error && (
          e.message.includes("Load failed") || 
          e.message.includes("Failed to fetch")
        )) {
          return {
            mode,
            plan: [],
            executed: false,
            results: [],
            timestamp: new Date().toISOString(),
            error: "network",
          };
        }
        throw e;
      }
    },
    onSuccess: (data) => {
      if (data.error === "forbidden") {
        toast.error("Доступ запрещён", { description: "Требуется роль super_admin" });
        return;
      }
      if (data.error === "network") {
        toast.error("Ошибка сети", { description: "Не удалось связаться с сервером" });
        return;
      }

      if (data.mode === "dry-run") {
        toast.info(`План автолечения: ${data.plan.length} действий`, {
          description: `Безопасных: ${data.plan.filter(p => p.safe).length}`,
        });
      } else {
        const successCount = data.results.filter(r => r.result === "success").length;
        const failedCount = data.results.filter(r => r.result === "failed").length;
        
        if (failedCount > 0) {
          toast.warning(`Автолечение: ${successCount} успешно, ${failedCount} ошибок`);
        } else {
          toast.success(`Автолечение: ${successCount} успешно`);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["system-health-reports"] });
      queryClient.invalidateQueries({ queryKey: ["system-health-latest-full"] });
    },
    onError: (error) => {
      toast.error("Ошибка автолечения", {
        description: String(error.message || error),
      });
    },
  });
}

// Status badge helpers
export const STATUS_CONFIG = {
  OK: {
    label: "OK",
    variant: "default" as const,
    color: "text-green-600",
    bgColor: "bg-green-100",
    icon: "CheckCircle",
  },
  DEGRADED: {
    label: "DEGRADED",
    variant: "secondary" as const,
    color: "text-yellow-600",
    bgColor: "bg-yellow-100",
    icon: "AlertTriangle",
  },
  CRITICAL: {
    label: "CRITICAL",
    variant: "destructive" as const,
    color: "text-red-600",
    bgColor: "bg-red-100",
    icon: "XCircle",
  },
};
