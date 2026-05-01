import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Month-gate resolver for cabinet lessons.
 *
 * Backend SOT: RPC `has_month_purchase_bulk` (mirrors _shared/check-month-purchase.ts).
 * Client only:
 *   1) Identifies which lessons have content_month + a matching active
 *      training_content rule with conditions.match_purchase_month=true,
 *   2) Resolves the rule's tariff_id,
 *   3) Calls the RPC with the (lesson, tariff, month) tuples,
 *   4) Returns lock metadata for lessons that didn't pass the gate.
 *
 * Lessons without content_month or without a matching month-gate rule are
 * NOT touched (lock_reason stays null). Existing behaviour is preserved.
 */

export interface MonthGateLessonInput {
  lesson_id: string;
  module_id: string;
  content_month: string | null; // YYYY-MM-DD or null
}

export type LockReason = "month_mismatch";

export interface MonthGateResult {
  lock_reason: LockReason;
  locked_month: string; // YYYY-MM-DD
}

export type MonthGateMap = Map<string, MonthGateResult>;

interface ModuleRow {
  id: string;
  product_id: string | null;
  parent_module_id: string | null;
}

interface TcRuleRow {
  id: string;
  tariff_id: string | null;
  target_ref: string;
  conditions: any;
}

function resolveRootProductId(
  moduleId: string,
  modulesById: Map<string, ModuleRow>
): string | null {
  // Walk up parent chain (with cycle/safety guard).
  let cur = modulesById.get(moduleId);
  const visited = new Set<string>();
  while (cur) {
    if (visited.has(cur.id)) return null;
    visited.add(cur.id);
    if (cur.product_id) return cur.product_id;
    if (!cur.parent_module_id) return null;
    cur = modulesById.get(cur.parent_module_id);
    if (visited.size > 20) return null;
  }
  return null;
}

function lessonInRuleScope(
  lessonId: string,
  moduleId: string,
  conditions: any
): boolean {
  const accessMode = conditions?.access_mode ?? "full";
  const allowedModules: string[] = Array.isArray(conditions?.allowed_module_ids)
    ? conditions.allowed_module_ids
    : [];
  const allowedLessons: string[] = Array.isArray(conditions?.allowed_lesson_ids)
    ? conditions.allowed_lesson_ids
    : [];

  if (accessMode === "full" && allowedModules.length === 0 && allowedLessons.length === 0) {
    return true;
  }
  if (allowedLessons.includes(lessonId)) return true;
  if (allowedModules.includes(moduleId)) return true;
  return false;
}

export function useMonthGate(lessons: MonthGateLessonInput[]): {
  map: MonthGateMap;
  loading: boolean;
} {
  const { user } = useAuth();
  const [map, setMap] = useState<MonthGateMap>(new Map());
  const [loading, setLoading] = useState(false);

  // Build a stable cache key from lesson ids only — content_month / module_id changes
  // for the same lesson are negligible at runtime within a session.
  const key = lessons
    .map((l) => l.lesson_id)
    .sort()
    .join(",");

  useEffect(() => {
    let cancelled = false;
    const result: MonthGateMap = new Map();

    if (!user || lessons.length === 0) {
      setMap(result);
      return;
    }

    // Only consider lessons with content_month set.
    const candidates = lessons.filter((l) => !!l.content_month);
    if (candidates.length === 0) {
      setMap(result);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        // 1) Load modules for candidate lessons + walk up parent chain to find root product_id.
        const moduleIds = Array.from(new Set(candidates.map((c) => c.module_id)));
        const modulesById = new Map<string, ModuleRow>();

        // Iteratively fetch modules and their parents (BFS up).
        let frontier = moduleIds;
        const known = new Set<string>();
        let iter = 0;
        while (frontier.length > 0 && iter++ < 10) {
          const toFetch = frontier.filter((id) => !known.has(id));
          if (toFetch.length === 0) break;
          toFetch.forEach((id) => known.add(id));
          const { data: mods, error } = await supabase
            .from("training_modules")
            .select("id, product_id, parent_module_id")
            .in("id", toFetch);
          if (error) throw error;
          for (const m of mods || []) {
            modulesById.set(m.id, m as ModuleRow);
          }
          frontier = (mods || [])
            .map((m: any) => m.parent_module_id)
            .filter((pid: string | null): pid is string => !!pid && !known.has(pid));
        }

        // 2) Resolve each lesson's root product_id and group by it for rule fetching.
        const lessonRootProduct = new Map<string, string>();
        for (const c of candidates) {
          const rootProd = resolveRootProductId(c.module_id, modulesById);
          if (rootProd) lessonRootProduct.set(c.lesson_id, rootProd);
        }
        const productIds = Array.from(new Set(lessonRootProduct.values()));
        if (productIds.length === 0) {
          if (!cancelled) setMap(result);
          return;
        }

        // 3) Fetch active training_content rules with match_purchase_month=true
        //    for the relevant root products.
        const { data: rulesRaw, error: rulesErr } = await supabase
          .from("access_rules")
          .select("id, tariff_id, target_ref, conditions")
          .eq("grant_target_type", "training_content")
          .eq("is_active", true)
          .in("target_ref", productIds);
        if (rulesErr) throw rulesErr;

        const rules: TcRuleRow[] = (rulesRaw || []).filter(
          (r: any) => r?.conditions?.match_purchase_month === true && r.tariff_id
        );
        if (rules.length === 0) {
          if (!cancelled) setMap(result);
          return;
        }

        // Index rules by target_ref (root product_id).
        const rulesByProduct = new Map<string, TcRuleRow[]>();
        for (const r of rules) {
          if (!rulesByProduct.has(r.target_ref)) rulesByProduct.set(r.target_ref, []);
          rulesByProduct.get(r.target_ref)!.push(r);
        }

        // 4) For each candidate lesson, find a matching rule -> build RPC payload.
        const payload: Array<{
          lesson_id: string;
          tariff_id: string;
          content_month: string;
        }> = [];
        const lessonMonthMap = new Map<string, string>();
        const lessonTariffMap = new Map<string, string>();

        for (const c of candidates) {
          const rootProd = lessonRootProduct.get(c.lesson_id);
          if (!rootProd) continue;
          const candidateRules = rulesByProduct.get(rootProd) || [];
          // Pick the first rule whose scope includes this lesson.
          const match = candidateRules.find((r) =>
            lessonInRuleScope(c.lesson_id, c.module_id, r.conditions)
          );
          if (!match || !match.tariff_id || !c.content_month) continue;
          payload.push({
            lesson_id: c.lesson_id,
            tariff_id: match.tariff_id,
            content_month: c.content_month,
          });
          lessonMonthMap.set(c.lesson_id, c.content_month);
          lessonTariffMap.set(c.lesson_id, match.tariff_id);
        }

        if (payload.length === 0) {
          if (!cancelled) setMap(result);
          return;
        }

        // 5) Single RPC call.
        const { data: rpcData, error: rpcErr } = await supabase.rpc(
          "has_month_purchase_bulk" as any,
          { _user_id: user.id, _items: payload as any }
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
            result.set(item.lesson_id, {
              lock_reason: "month_mismatch",
              locked_month: item.content_month,
            });
          }
        }

        if (!cancelled) setMap(result);
      } catch (err) {
        console.warn("[useMonthGate] resolution failed (fallback: open):", err);
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

/** Helper for UI: format YYYY-MM-DD → MM.YYYY */
export function formatLockedMonth(month: string): string {
  // Accept YYYY-MM-DD or YYYY-MM
  const [y, m] = month.split("-");
  if (!y || !m) return month;
  return `${m.padStart(2, "0")}.${y}`;
}
