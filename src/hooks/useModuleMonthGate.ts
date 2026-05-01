import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Module-level month-gate resolver (mirrors useMonthGate but operates on module_id).
 *
 * SOT chain:
 *   training_modules.content_month  (UUID/value, no slugs/titles)
 *   ↓
 *   active access_rule (grant_target_type='training_content',
 *                       target_ref=root_module_id,
 *                       conditions.match_purchase_month=true,
 *                       tariff_id=X)
 *   ↓
 *   orders_v2.meta.deal_month (status='paid', source <> 'rule_engine')
 *
 * Reuses RPC `has_month_purchase_bulk` — `lesson_id` field acts as opaque key,
 * here we pass module_id. SOT logic identical.
 */

export interface ModuleMonthGateInput {
  module_id: string;
  /** YYYY-MM or YYYY-MM-DD or null */
  content_month: string | null;
  /** Root module id for access_rules.target_ref lookup. If null, hook walks parent chain. */
  root_module_id?: string | null;
  /** Parent module id for chain walk fallback. */
  parent_module_id?: string | null;
}

export interface ModuleGateResult {
  lock_reason: "month_mismatch";
  locked_month: string; // YYYY-MM
  required_tariff_id: string;
}

export type ModuleMonthGateMap = Map<string, ModuleGateResult>;

interface ModuleRow {
  id: string;
  parent_module_id: string | null;
}

interface TcRuleRow {
  id: string;
  tariff_id: string | null;
  target_ref: string;
  conditions: any;
}

function resolveRootModuleId(
  moduleId: string,
  modulesById: Map<string, ModuleRow>,
): string | null {
  let cur = modulesById.get(moduleId);
  const visited = new Set<string>();
  while (cur) {
    if (visited.has(cur.id)) return null;
    visited.add(cur.id);
    if (!cur.parent_module_id) return cur.id;
    cur = modulesById.get(cur.parent_module_id);
    if (visited.size > 20) return null;
  }
  return null;
}

function moduleInRuleScope(moduleId: string, conditions: any): boolean {
  const accessMode = conditions?.access_mode ?? "full";
  const allowedModules: string[] = Array.isArray(conditions?.allowed_module_ids)
    ? conditions.allowed_module_ids
    : [];
  if (accessMode === "full" && allowedModules.length === 0) return true;
  if (allowedModules.includes(moduleId)) return true;
  return false;
}

export function useModuleMonthGate(modules: ModuleMonthGateInput[]): {
  map: ModuleMonthGateMap;
  loading: boolean;
} {
  const { user } = useAuth();
  const [map, setMap] = useState<ModuleMonthGateMap>(new Map());
  const [loading, setLoading] = useState(false);

  const key = modules
    .map((m) => `${m.module_id}:${m.content_month ?? ""}`)
    .sort()
    .join(",");

  useEffect(() => {
    let cancelled = false;
    const result: ModuleMonthGateMap = new Map();

    if (!user || modules.length === 0) {
      setMap(result);
      return;
    }

    const candidates = modules.filter((m) => !!m.content_month);
    if (candidates.length === 0) {
      setMap(result);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        // Build module chain map (BFS up).
        const modulesById = new Map<string, ModuleRow>();
        let frontier = Array.from(new Set(candidates.map((c) => c.module_id)));
        const known = new Set<string>();
        let iter = 0;
        while (frontier.length > 0 && iter++ < 10) {
          const toFetch = frontier.filter((id) => !known.has(id));
          if (toFetch.length === 0) break;
          toFetch.forEach((id) => known.add(id));
          const { data: mods, error } = await supabase
            .from("training_modules")
            .select("id, parent_module_id")
            .in("id", toFetch);
          if (error) throw error;
          for (const m of mods || []) modulesById.set(m.id, m as ModuleRow);
          frontier = (mods || [])
            .map((m: any) => m.parent_module_id)
            .filter((pid: string | null): pid is string => !!pid && !known.has(pid));
        }

        // Resolve root module id for each candidate.
        const moduleRoot = new Map<string, string>();
        for (const c of candidates) {
          const rootMod =
            c.root_module_id ?? resolveRootModuleId(c.module_id, modulesById);
          if (rootMod) moduleRoot.set(c.module_id, rootMod);
        }

        const rootIds = Array.from(new Set(moduleRoot.values()));
        if (rootIds.length === 0) {
          if (!cancelled) setMap(result);
          return;
        }

        const { data: rulesRaw, error: rulesErr } = await supabase
          .from("access_rules")
          .select("id, tariff_id, target_ref, conditions")
          .eq("grant_target_type", "training_content")
          .eq("is_active", true)
          .in("target_ref", rootIds);
        if (rulesErr) throw rulesErr;

        const rules: TcRuleRow[] = (rulesRaw || []).filter(
          (r: any) => r?.conditions?.match_purchase_month === true && r.tariff_id,
        );
        if (rules.length === 0) {
          if (!cancelled) setMap(result);
          return;
        }

        const rulesByRoot = new Map<string, TcRuleRow[]>();
        for (const r of rules) {
          if (!rulesByRoot.has(r.target_ref)) rulesByRoot.set(r.target_ref, []);
          rulesByRoot.get(r.target_ref)!.push(r);
        }

        const payload: Array<{
          lesson_id: string; // opaque key = module_id
          tariff_id: string;
          content_month: string;
        }> = [];
        const moduleTariff = new Map<string, string>();
        const moduleMonth = new Map<string, string>();

        for (const c of candidates) {
          const rootMod = moduleRoot.get(c.module_id);
          if (!rootMod) continue;
          const candidateRules = rulesByRoot.get(rootMod) || [];
          const match = candidateRules.find((r) =>
            moduleInRuleScope(c.module_id, r.conditions),
          );
          if (!match || !match.tariff_id || !c.content_month) continue;
          payload.push({
            lesson_id: c.module_id,
            tariff_id: match.tariff_id,
            content_month: c.content_month,
          });
          moduleTariff.set(c.module_id, match.tariff_id);
          moduleMonth.set(c.module_id, c.content_month);
        }

        if (payload.length === 0) {
          if (!cancelled) setMap(result);
          return;
        }

        const { data: rpcData, error: rpcErr } = await supabase.rpc(
          "has_month_purchase_bulk" as any,
          { _user_id: user.id, _items: payload as any },
        );
        if (rpcErr) throw rpcErr;

        const okSet = new Set<string>();
        for (const row of (rpcData as any[]) || []) {
          if (row?.has_purchase === true && row?.lesson_id) {
            okSet.add(row.lesson_id);
          }
        }

        for (const item of payload) {
          if (!okSet.has(item.lesson_id)) {
            const monthKey = item.content_month.length >= 7
              ? item.content_month.substring(0, 7)
              : item.content_month;
            result.set(item.lesson_id, {
              lock_reason: "month_mismatch",
              locked_month: monthKey,
              required_tariff_id: item.tariff_id,
            });
          }
        }

        if (!cancelled) setMap(result);
      } catch (err) {
        console.warn("[useModuleMonthGate] resolution failed (fallback: open):", err);
        if (!cancelled) setMap(new Map());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, user?.id]);

  return { map, loading };
}

/** YYYY-MM → MM.YYYY */
export function formatLockedMonth(month: string): string {
  const [y, m] = month.split("-");
  if (!y || !m) return month;
  return `${m.padStart(2, "0")}.${y}`;
}
