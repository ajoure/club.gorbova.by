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

/**
 * Walk up parent_module_id chain to find the ROOT training_module.id.
 * Root = module with parent_module_id = null. This is what
 * access_rules.target_ref points to for grant_target_type='training_content'.
 */
function resolveRootModuleId(
  moduleId: string,
  modulesById: Map<string, ModuleRow>
): string | null {
  let cur = modulesById.get(moduleId);
  const visited = new Set<string>();
  while (cur) {
    if (visited.has(cur.id)) return null;
    visited.add(cur.id);
    if (!cur.parent_module_id) return cur.id; // reached root
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

        // 2) Resolve each lesson's ROOT module_id (target_ref of training_content rules).
        const lessonRootModule = new Map<string, string>();
        for (const c of candidates) {
          const rootMod = resolveRootModuleId(c.module_id, modulesById);
          if (rootMod) lessonRootModule.set(c.lesson_id, rootMod);
        }
        const rootModuleIds = Array.from(new Set(lessonRootModule.values()));
        if (rootModuleIds.length === 0) {
          if (!cancelled) setMap(result);
          return;
        }

        // 3) Fetch active training_content rules with match_purchase_month=true
        //    whose target_ref points to one of these root modules.
        const { data: rulesRaw, error: rulesErr } = await supabase
          .from("access_rules")
          .select("id, tariff_id, target_ref, conditions, product_id")
          .eq("grant_target_type", "training_content")
          .eq("is_active", true)
          .in("target_ref", rootModuleIds);
        if (rulesErr) throw rulesErr;

        const rules: TcRuleRow[] = (rulesRaw || []).filter(
          (r: any) => r?.conditions?.match_purchase_month === true && r.tariff_id
        );

        // PATCH-WEBINAR-PRODUCT-VISIBILITY-BYPASS-V1
        // Explicit product-grant bypass: rule must be active, training_content,
        // target_ref ∈ rootModuleIds, have product_id and a non-empty explicit
        // allowlist (allowed_module_ids OR allowed_lesson_ids).
        // full/root rules with both allowlists empty DO NOT bypass.
        const bypassCandidateRules = (rulesRaw || []).filter((r: any) => {
          const am = r?.conditions?.allowed_module_ids;
          const al = r?.conditions?.allowed_lesson_ids;
          const hasAllow =
            (Array.isArray(am) && am.length > 0) ||
            (Array.isArray(al) && al.length > 0);
          return r?.product_id && hasAllow;
        });
        const bypassProductIds = Array.from(
          new Set(bypassCandidateRules.map((r: any) => r.product_id as string))
        );
        const bypassModuleIds = new Set<string>();
        const bypassLessonIds = new Set<string>();
        if (bypassProductIds.length > 0) {
          const { data: entRows } = await supabase
            .from("entitlements")
            .select("product_id, status, expires_at")
            .eq("user_id", user.id)
            .eq("status", "active")
            .in("product_id", bypassProductIds);
          const nowMs = Date.now();
          const activeProductIds = new Set<string>(
            (entRows || [])
              .filter(
                (e: any) =>
                  !e.expires_at || new Date(e.expires_at).getTime() > nowMs
              )
              .map((e: any) => e.product_id as string)
          );
          for (const r of bypassCandidateRules) {
            if (!activeProductIds.has(r.product_id)) continue;
            const cond = r.conditions as any;
            for (const mid of (cond.allowed_module_ids as string[] | undefined) || []) {
              bypassModuleIds.add(mid);
            }
            for (const lid of (cond.allowed_lesson_ids as string[] | undefined) || []) {
              bypassLessonIds.add(lid);
            }
          }
        }

        if (rules.length === 0) {
          if (!cancelled) setMap(result);
          return;
        }


        // 4) For each candidate lesson, find a matching rule -> build RPC payload.
        // OR-aggregation across ALL matching rules. If ANY matching tariff
        // grants the month purchase, the lesson is unlocked.
        // Synthetic RPC key = `${lesson_id}::${tariff_id}` to disambiguate
        // multiple (lesson, tariff) tuples within one RPC batch.
        const payload: Array<{
          lesson_id: string; // synthetic key
          tariff_id: string;
          content_month: string;
        }> = [];
        // Map<lesson_id, Array<{ syntheticKey, tariff_id, content_month }>>
        const lessonTuples = new Map<
          string,
          Array<{ syntheticKey: string; tariff_id: string; content_month: string }>
        >();

        for (const c of candidates) {
          const rootMod = lessonRootModule.get(c.lesson_id);
          if (!rootMod || !c.content_month) continue;
          const candidateRules = rulesByRootModule.get(rootMod) || [];
          const matches = candidateRules.filter((r) =>
            lessonInRuleScope(c.lesson_id, c.module_id, r.conditions)
          );
          if (matches.length === 0) continue;

          // Deduplicate by tariff_id (multiple rules may carry same tariff).
          const seenTariffs = new Set<string>();
          for (const m of matches) {
            if (!m.tariff_id || seenTariffs.has(m.tariff_id)) continue;
            seenTariffs.add(m.tariff_id);
            const syntheticKey = `${c.lesson_id}::${m.tariff_id}`;
            payload.push({
              lesson_id: syntheticKey,
              tariff_id: m.tariff_id,
              content_month: c.content_month,
            });
            if (!lessonTuples.has(c.lesson_id)) lessonTuples.set(c.lesson_id, []);
            lessonTuples.get(c.lesson_id)!.push({
              syntheticKey,
              tariff_id: m.tariff_id,
              content_month: c.content_month,
            });
          }
        }

        if (payload.length === 0) {
          if (!cancelled) setMap(result);
          return;
        }

        const { data: rpcData, error: rpcErr } = await supabase.rpc(
          "has_month_purchase_bulk" as any,
          { _user_id: user.id, _items: payload as any }
        );
        if (rpcErr) throw rpcErr;

        const okSyntheticKeys = new Set<string>();
        for (const row of (rpcData as any[]) || []) {
          if (row?.has_purchase === true && row?.lesson_id) {
            okSyntheticKeys.add(row.lesson_id);
          }
        }

        // OR-aggregate per lesson: locked only if NO tuple passed.
        for (const [lessonId, tuples] of lessonTuples.entries()) {
          const anyOk = tuples.some((t) => okSyntheticKeys.has(t.syntheticKey));
          if (!anyOk) {
            result.set(lessonId, {
              lock_reason: "month_mismatch",
              locked_month: tuples[0].content_month,
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
