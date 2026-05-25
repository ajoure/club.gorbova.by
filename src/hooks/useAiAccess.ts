import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AiAccessQuotaSlot {
  used: number;
  limit: number;
  remaining: number;
}

export interface AiAccessQuota {
  daily: AiAccessQuotaSlot;
  monthly: AiAccessQuotaSlot;
}

export interface AiAccessStatus {
  tier: "full" | "zg_only" | "none";
  allowed_modes: { chat: boolean; prompt: boolean };
  allowed_scenarios: Array<{ code: string; allowed: boolean; denial_reason?: string }>;
  quota_by_mode: {
    chat: AiAccessQuota;
    balance_analysis: AiAccessQuota;
    "107NK": AiAccessQuota;
  };
  cta_target: { business_url: string; club_url: string };
  denial_reasons: Record<string, string>;
}

/**
 * Read-only projection: тонкий вызов edge `ai-access-status`, которая
 * зовёт shared `resolveAiAccessStatus`. Frontend НЕ домысливает access-логику,
 * только рендерит уже посчитанный результат.
 */
export function useAiAccess() {
  return useQuery<AiAccessStatus>({
    queryKey: ["ai-access-status"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-access-status", { method: "GET" });
      if (error) throw error;
      return data as AiAccessStatus;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function isScenarioAllowed(status: AiAccessStatus | undefined, code: string | null | undefined): boolean {
  if (!status || !code) return false;
  return !!status.allowed_scenarios.find((s) => s.code === code)?.allowed;
}

export function scenarioDenialMessage(status: AiAccessStatus | undefined, code: string | null | undefined): string | undefined {
  if (!status || !code) return undefined;
  const s = status.allowed_scenarios.find((x) => x.code === code);
  if (!s || s.allowed) return undefined;
  return s.denial_reason ? status.denial_reasons[s.denial_reason] : status.denial_reasons.no_access;
}
