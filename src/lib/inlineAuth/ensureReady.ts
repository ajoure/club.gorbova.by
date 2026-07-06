/**
 * ensureInlineAuthReady — pre-submit guard.
 *
 * Единая проверка готовности сессии перед вызовом защищённых edge-functions
 * (submit-lead-request, оплата и т.д.). Используется вызывающими диалогами
 * (PaymentDialog / LeadRequestDialog / PreregistrationDialog) перед submit,
 * чтобы избежать 401 email_not_confirmed после подтверждения из другого таба.
 *
 * Порядок (важен):
 *   1. getSession — если сессии нет, возвращаем no_session (refreshSession
 *      без refresh_token в localStorage бросает ошибку и ломает UI).
 *   2. refreshSession — форс-обновление, если сессия есть, но токен старый.
 *   3. getSession повторно — проверить, что после refresh session валидна.
 *   4. getUser — серверная валидация, обязательно для email_confirmed_at.
 */
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type EnsureReadyReason =
  | "no_session"
  | "refresh_failed"
  | "no_user"
  | "email_not_confirmed"
  | "unknown_error";

export type EnsureReadyResult =
  | { ok: true; user: User }
  | { ok: false; reason: EnsureReadyReason; message?: string };

export async function ensureInlineAuthReady(): Promise<EnsureReadyResult> {
  try {
    const initial = await supabase.auth.getSession();
    if (!initial.data.session?.access_token) {
      return { ok: false, reason: "no_session" };
    }

    // Refresh только если session уже есть — иначе бросается AuthSessionMissingError
    try {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error && !refreshed.data.session) {
        // Refresh не удался (напр. refresh_token отозван). Не считаем это фатальным,
        // если текущая сессия ещё валидна — checkUser покажет.
        console.warn("[ensureInlineAuthReady] refreshSession failed, falling through:", refreshed.error);
      }
    } catch (e) {
      console.warn("[ensureInlineAuthReady] refreshSession threw:", e);
    }

    const after = await supabase.auth.getSession();
    if (!after.data.session?.access_token) {
      return { ok: false, reason: "refresh_failed" };
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return { ok: false, reason: "no_user", message: userError?.message };
    }
    if (!userData.user.email_confirmed_at) {
      return { ok: false, reason: "email_not_confirmed" };
    }
    return { ok: true, user: userData.user };
  } catch (e: any) {
    console.error("[ensureInlineAuthReady] unexpected error:", e);
    return { ok: false, reason: "unknown_error", message: e?.message };
  }
}

/**
 * ensureInlineAuthReadyWithRetry — то же самое, но с коротким retry.
 *
 * Причина: после email confirmation в другой вкладке текущая вкладка может
 * получить событие раньше, чем сам Supabase применит новую сессию — быстрый
 * retry устраняет edge-case «только что подтвердили, но getUser ещё
 * возвращает старого» без сваливания в 401.
 */
export async function ensureInlineAuthReadyWithRetry(opts?: {
  retries?: number;
  delayMs?: number;
}): Promise<EnsureReadyResult> {
  const retries = opts?.retries ?? 2;
  const delayMs = opts?.delayMs ?? 500;
  let last: EnsureReadyResult = { ok: false, reason: "unknown_error" };
  for (let i = 0; i <= retries; i++) {
    last = await ensureInlineAuthReady();
    if (last.ok) return last;
    const failed = last as Extract<EnsureReadyResult, { ok: false }>;
    if (failed.reason === "no_session") return failed;
    if (i < retries) await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}
