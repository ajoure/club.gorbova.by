import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 6-B — Unified read-model для подключений эквайринга.
 *
 * Объединяет два разных источника в одну форму AcquiringProfile:
 *  - Stripe → public.acquiring_connections WHERE provider='stripe' AND status='active'
 *  - bePaid → public.integration_instances WHERE provider='bepaid' AND status IN ('active','connected')
 *
 * Никакой write-логики, никаких миграций. Только read-layer для UI.
 *
 * Контракт зафиксирован в .lovable/discovery/phase_6_payment_profiles_inventory_v1.md
 */

export type AcquiringProviderId = "bepaid" | "stripe";

export interface AcquiringProfile {
  provider: AcquiringProviderId;
  /** Стабильный внутренний id подключения (для сохранения в meta.acquiring). */
  account_code: string;
  /** Человекочитаемое имя для UI. Всегда непустое. */
  display_name: string;
  /** Технический ярлык-fallback, если у подключения нет нормального имени. */
  technical_label?: string;
  /** bePaid only. */
  shop_id?: string | null;
  test_mode: boolean;
  status: "active" | "inactive";
  /** Stripe only. Lowercase ISO codes. */
  supported_currencies?: string[];
  is_default: boolean;
}

function mapStripeRow(r: any): AcquiringProfile {
  const accountName = (r.account_name ?? "").trim();
  const supported = r?.capabilities_snapshot?.supported_currencies;
  return {
    provider: "stripe",
    account_code: r.account_code,
    display_name: accountName || `Stripe — подключение без названия`,
    technical_label: accountName ? undefined : r.account_code,
    test_mode: !!r.test_mode,
    status: r.status === "active" ? "active" : "inactive",
    supported_currencies: Array.isArray(supported)
      ? supported.map((c: unknown) => String(c).toLowerCase())
      : undefined,
    is_default: !!r.is_default,
  };
}

function mapBepaidRow(r: any): AcquiringProfile {
  const cfg = r.config ?? {};
  const shopId = cfg.shop_id ? String(cfg.shop_id) : null;
  const isTest = cfg.test_mode === true || cfg.test_mode === "true";
  const alias = (r.alias ?? "").trim();
  const displayName =
    alias ||
    (shopId ? `bePaid — Shop ID ${shopId}` : "bePaid — подключение без названия");
  return {
    provider: "bepaid",
    account_code: shopId ? `bepaid_${shopId}` : `bepaid_${r.id}`,
    display_name: displayName,
    technical_label: alias ? undefined : shopId ?? r.id,
    shop_id: shopId,
    test_mode: isTest,
    status: r.status === "connected" || r.status === "active" ? "active" : "inactive",
    is_default: !!r.is_default,
  };
}

export function useAcquiringProfiles() {
  return useQuery({
    queryKey: ["acquiring-profiles-unified-v1"],
    queryFn: async (): Promise<AcquiringProfile[]> => {
      const [stripeRes, bepaidRes] = await Promise.all([
        supabase
          .from("acquiring_connections")
          .select(
            "account_code, account_name, test_mode, is_default, status, capabilities_snapshot",
          )
          .eq("provider", "stripe")
          .eq("status", "active")
          .order("is_default", { ascending: false })
          .order("account_name"),
        supabase
          .from("integration_instances")
          .select("id, alias, status, is_default, config")
          .eq("provider", "bepaid")
          .in("status", ["active", "connected"])
          .order("is_default", { ascending: false })
          .order("alias"),
      ]);

      if (stripeRes.error) throw stripeRes.error;
      if (bepaidRes.error) throw bepaidRes.error;

      const stripe = (stripeRes.data ?? []).map(mapStripeRow);
      const bepaid = (bepaidRes.data ?? []).map(mapBepaidRow);

      // bepaid сначала (как основной для BYN), затем stripe
      return [...bepaid, ...stripe];
    },
    staleTime: 60_000,
  });
}

/**
 * Резолвер default-подключения для указанного провайдера:
 *   1) is_default=true
 *   2) первый active
 *   3) null
 * Также возвращает признак конфликта (несколько active без default) для admin-warning.
 */
export function resolveDefaultProfile(
  profiles: AcquiringProfile[] | undefined,
  provider: AcquiringProviderId,
): { profile: AcquiringProfile | null; conflict: boolean } {
  const list = (profiles ?? []).filter(
    (p) => p.provider === provider && p.status === "active",
  );
  if (list.length === 0) return { profile: null, conflict: false };
  const explicitDefault = list.find((p) => p.is_default);
  if (explicitDefault) return { profile: explicitDefault, conflict: false };
  return { profile: list[0], conflict: list.length > 1 };
}

export function filterByProvider(
  profiles: AcquiringProfile[] | undefined,
  provider: AcquiringProviderId,
): AcquiringProfile[] {
  return (profiles ?? []).filter((p) => p.provider === provider && p.status === "active");
}
