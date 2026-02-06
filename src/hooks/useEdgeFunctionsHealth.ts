import { useState, useCallback } from "react";

export interface EdgeFunctionStatus {
  name: string;
  category: "payments" | "telegram" | "system" | "integration";
  status: "ok" | "not_found" | "error" | "pending" | "checking" | "slow_preflight";
  latency: number | null;
  lastCheck: Date | null;
  error?: string;
}

export const TIER1_FUNCTIONS: Array<{ name: string; category: EdgeFunctionStatus["category"] }> = [
  // Payments
  { name: "payment-method-verify-recurring", category: "payments" },
  { name: "bepaid-list-subscriptions", category: "payments" },
  { name: "bepaid-get-subscription-details", category: "payments" },
  { name: "bepaid-create-token", category: "payments" },
  { name: "admin-payments-diagnostics", category: "payments" },
  { name: "payment-methods-webhook", category: "payments" },
  // System
  { name: "nightly-system-health", category: "system" },
  { name: "nightly-payments-invariants", category: "system" },
  { name: "integration-healthcheck", category: "integration" },
  // Telegram
  { name: "telegram-webhook", category: "telegram" },
  { name: "telegram-admin-chat", category: "telegram" },
  { name: "telegram-grant-access", category: "telegram" },
  { name: "telegram-revoke-access", category: "telegram" },
  { name: "telegram-check-expired", category: "telegram" },
];

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const OPTIONS_TIMEOUT = 15000; // 15s for OPTIONS
const POST_TIMEOUT = 10000;    // 10s for POST fallback

export function useEdgeFunctionsHealth() {
  const [functions, setFunctions] = useState<EdgeFunctionStatus[]>(
    TIER1_FUNCTIONS.map((f) => ({
      name: f.name,
      category: f.category,
      status: "pending",
      latency: null,
      lastCheck: null,
    }))
  );
  const [isChecking, setIsChecking] = useState(false);
  const [lastFullCheck, setLastFullCheck] = useState<Date | null>(null);

  /**
   * Check if function exists via POST ping (fallback when OPTIONS fails)
   * Returns: ok (2xx/4xx = exists), not_found (404), error (timeout/other)
   */
  const checkViaPost = useCallback(async (name: string): Promise<{
    status: "ok" | "not_found" | "error";
    latency: number;
    error?: string;
  }> => {
    const startTime = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), POST_TIMEOUT);

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ping: true }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency = Math.round(performance.now() - startTime);

      // Check for 404
      if (response.status === 404) {
        const text = await response.text();
        if (text.includes('"code":"NOT_FOUND"') || text.includes("Function not found")) {
          return { status: "not_found", latency, error: "Function not deployed (404)" };
        }
      }

      // 2xx, 4xx (except 404), 5xx with body = function exists
      // Even 401/403 means the function is deployed but auth is required
      return { status: "ok", latency };
    } catch (err) {
      clearTimeout(timeoutId);
      const latency = Math.round(performance.now() - startTime);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      
      return {
        status: "error",
        latency,
        error: errorMessage.includes("abort") ? `POST timeout (${POST_TIMEOUT/1000}s)` : errorMessage,
      };
    }
  }, []);

  const checkFunction = useCallback(async (name: string): Promise<EdgeFunctionStatus> => {
    const functionDef = TIER1_FUNCTIONS.find((f) => f.name === name);
    if (!functionDef) {
      return {
        name,
        category: "system",
        status: "error",
        latency: null,
        lastCheck: new Date(),
        error: "Unknown function",
      };
    }

    const startTime = performance.now();

    try {
      // Step 1: Try OPTIONS request (15s timeout)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), OPTIONS_TIMEOUT);

      const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
        method: "OPTIONS",
        headers: {
          "Origin": window.location.origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization, content-type",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency = Math.round(performance.now() - startTime);

      // Check response for NOT_FOUND (absolute blocker, no need for POST)
      if (response.status === 404) {
        return {
          name,
          category: functionDef.category,
          status: "not_found",
          latency,
          lastCheck: new Date(),
          error: "Function not deployed (404)",
        };
      }

      // Also check response body for NOT_FOUND code
      const text = await response.text();
      if (text.includes('"code":"NOT_FOUND"')) {
        return {
          name,
          category: functionDef.category,
          status: "not_found",
          latency,
          lastCheck: new Date(),
          error: "Function not deployed",
        };
      }

      // OPTIONS succeeded
      return {
        name,
        category: functionDef.category,
        status: "ok",
        latency,
        lastCheck: new Date(),
      };
    } catch (err) {
      const optionsLatency = Math.round(performance.now() - startTime);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      const isTimeout = errorMessage.includes("abort");

      // Step 2: OPTIONS failed/timeout → try POST fallback
      const postResult = await checkViaPost(name);
      
      if (postResult.status === "ok") {
        // OPTIONS timeout but POST worked → slow_preflight (function exists, cold start issue)
        return {
          name,
          category: functionDef.category,
          status: isTimeout ? "slow_preflight" : "ok",
          latency: postResult.latency,
          lastCheck: new Date(),
          error: isTimeout ? `OPTIONS timeout (${OPTIONS_TIMEOUT/1000}s), POST OK` : undefined,
        };
      }

      if (postResult.status === "not_found") {
        return {
          name,
          category: functionDef.category,
          status: "not_found",
          latency: postResult.latency,
          lastCheck: new Date(),
          error: postResult.error,
        };
      }

      // Both OPTIONS and POST failed
      return {
        name,
        category: functionDef.category,
        status: "error",
        latency: optionsLatency,
        lastCheck: new Date(),
        error: isTimeout 
          ? `Timeout (OPTIONS ${OPTIONS_TIMEOUT/1000}s, POST ${POST_TIMEOUT/1000}s)` 
          : errorMessage,
      };
    }
  }, [checkViaPost]);

  const checkSingleFunction = useCallback(async (name: string) => {
    // Set status to checking
    setFunctions((prev) =>
      prev.map((f) => (f.name === name ? { ...f, status: "checking" as const } : f))
    );

    const result = await checkFunction(name);

    setFunctions((prev) =>
      prev.map((f) => (f.name === name ? result : f))
    );

    return result;
  }, [checkFunction]);

  const checkAllFunctions = useCallback(async () => {
    setIsChecking(true);
    
    // Set all to checking
    setFunctions((prev) =>
      prev.map((f) => ({ ...f, status: "checking" as const }))
    );

    // Check all in parallel
    const results = await Promise.all(
      TIER1_FUNCTIONS.map((f) => checkFunction(f.name))
    );

    setFunctions(results);
    setLastFullCheck(new Date());
    setIsChecking(false);

    return results;
  }, [checkFunction]);

  // Get stats
  const stats = {
    total: functions.length,
    ok: functions.filter((f) => f.status === "ok" || f.status === "slow_preflight").length,
    notFound: functions.filter((f) => f.status === "not_found").length,
    error: functions.filter((f) => f.status === "error").length,
    pending: functions.filter((f) => f.status === "pending" || f.status === "checking").length,
  };

  // Group by category
  const byCategory = TIER1_FUNCTIONS.reduce((acc, def) => {
    if (!acc[def.category]) acc[def.category] = [];
    const fn = functions.find((f) => f.name === def.name);
    if (fn) acc[def.category].push(fn);
    return acc;
  }, {} as Record<string, EdgeFunctionStatus[]>);

  return {
    functions,
    stats,
    byCategory,
    isChecking,
    lastFullCheck,
    checkSingleFunction,
    checkAllFunctions,
  };
}

export const CATEGORY_LABELS_RU: Record<string, string> = {
  payments: "Платежи",
  telegram: "Telegram",
  system: "Система",
  integration: "Интеграции",
};
