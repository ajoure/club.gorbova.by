/**
 * useAwaitInlineAuthReady — единый waiter подтверждения email для всех inline-flows.
 *
 * Источник истины: Supabase Auth (getSession → refreshSession → getUser).
 * Ускорители (BroadcastChannel/storage/onAuthStateChange) применяются только
 * для same-origin — они лишь снижают латентность, не подменяют polling.
 *
 * Единый waiter для:
 *   - нового signUp;
 *   - существующего пользователя с email_not_confirmed при login;
 *   - повторного входа после resend confirmation.
 *
 * Защита от бесконечного ожидания: таймаут 5 мин + кнопки resend / changeEmail.
 * Защита от гонок: onReady вызывается ровно один раз, все каналы очищаются.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { subscribeInlineAuth } from "@/lib/inlineAuth/broadcast";
import { ensureInlineAuthReady } from "@/lib/inlineAuth/ensureReady";

export type AwaitState =
  | "idle"
  | "waiting_confirm"
  | "ready"
  | "expired"
  | "error";

export const WAIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 минут
export const POLL_INTERVAL_MS = 3000;

/**
 * Canonical emailRedirectTo для всех inline-signup/resend вызовов.
 * После successful verify AuthVerifyProxy сам показывает success-screen
 * и публикует событие в BroadcastChannel/localStorage — оба таба узнают.
 */
export function buildAuthVerifyRedirect(): string {
  return `${window.location.origin}/auth-verify`;
}

export interface UseAwaitInlineAuthReadyArgs {
  email: string;
  flowId: string;
  enabled: boolean;
  onReady: (user: User) => void;
  onExpired?: () => void;
}

export interface UseAwaitInlineAuthReadyReturn {
  state: AwaitState;
  remainingMs: number;
  error: string | null;
  resend: () => Promise<{ ok: boolean; error?: string }>;
  changeEmail: () => void;
  cancel: () => void;
}

export function useAwaitInlineAuthReady(
  args: UseAwaitInlineAuthReadyArgs,
): UseAwaitInlineAuthReadyReturn {
  const { email, flowId, enabled, onReady, onExpired } = args;

  const [state, setState] = useState<AwaitState>(enabled ? "waiting_confirm" : "idle");
  const [remainingMs, setRemainingMs] = useState(WAIT_TIMEOUT_MS);
  const [error, setError] = useState<string | null>(null);

  // Refs для защиты от гонок и очистки
  const readyFiredRef = useRef(false);
  const cancelledRef = useRef(false);
  const startedAtRef = useRef<number>(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onReadyRef = useRef(onReady);
  const onExpiredRef = useRef(onExpired);
  onReadyRef.current = onReady;
  onExpiredRef.current = onExpired;

  const cleanupTimers = useCallback(() => {
    if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
    if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
    if (timeoutTimerRef.current) { clearTimeout(timeoutTimerRef.current); timeoutTimerRef.current = null; }
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* noop */ } abortRef.current = null; }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    cleanupTimers();
    if (!readyFiredRef.current) setState("idle");
  }, [cleanupTimers]);

  const checkNow = useCallback(async () => {
    if (readyFiredRef.current || cancelledRef.current) return;
    const res = await ensureInlineAuthReady();
    if (readyFiredRef.current || cancelledRef.current) return;
    if (res.ok) {
      readyFiredRef.current = true;
      cleanupTimers();
      setState("ready");
      try { onReadyRef.current(res.user); } catch (e) { console.error("[useAwaitInlineAuthReady] onReady threw:", e); }
    }
  }, [cleanupTimers]);

  // Polling loop — работает всегда, независимо от ускорителей.
  const schedulePoll = useCallback(() => {
    if (readyFiredRef.current || cancelledRef.current) return;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(async () => {
      await checkNow();
      if (!readyFiredRef.current && !cancelledRef.current) schedulePoll();
    }, POLL_INTERVAL_MS);
  }, [checkNow]);

  // Основной эффект — старт waiter
  useEffect(() => {
    if (!enabled) return;
    readyFiredRef.current = false;
    cancelledRef.current = false;
    startedAtRef.current = Date.now();
    setState("waiting_confirm");
    setRemainingMs(WAIT_TIMEOUT_MS);
    setError(null);

    // Немедленная проверка (вдруг сессия уже готова)
    void checkNow();

    // Polling
    schedulePoll();

    // Тикер для UI-таймера
    tickTimerRef.current = setInterval(() => {
      const left = Math.max(0, WAIT_TIMEOUT_MS - (Date.now() - startedAtRef.current));
      setRemainingMs(left);
    }, 1000);

    // Жёсткий таймаут
    timeoutTimerRef.current = setTimeout(() => {
      if (readyFiredRef.current || cancelledRef.current) return;
      cleanupTimers();
      setState("expired");
      try { onExpiredRef.current?.(); } catch (e) { console.error("[useAwaitInlineAuthReady] onExpired threw:", e); }
    }, WAIT_TIMEOUT_MS);

    // Ускоритель 1: BroadcastChannel + storage (same-origin only)
    const unsubBroadcast = subscribeInlineAuth((evt) => {
      if (readyFiredRef.current) return;
      // flowId может быть undefined (событие от общего auth-verify) — всё равно
      // делаем немедленную проверку сессии.
      if (evt.flowId && flowId && evt.flowId !== flowId) return;
      void checkNow();
    });

    // Ускоритель 2: onAuthStateChange (same-origin, тот же клиент)
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (readyFiredRef.current) return;
      if (event === "USER_UPDATED" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void checkNow();
      }
    });

    return () => {
      cancelledRef.current = true;
      cleanupTimers();
      try { unsubBroadcast(); } catch { /* noop */ }
      try { authSub.subscription.unsubscribe(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, flowId]);

  const resend = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!email) return { ok: false, error: "no_email" };
    try {
      const { error: resendErr } = await supabase.auth.resend({
        type: "signup",
        email: email.toLowerCase().trim(),
        options: { emailRedirectTo: buildAuthVerifyRedirect() },
      });
      if (resendErr) {
        setError(resendErr.message || "resend_failed");
        return { ok: false, error: resendErr.message };
      }
      // Дублируем через auth-actions для надёжной доставки (Yandex-SMTP)
      try {
        await supabase.functions.invoke("auth-actions", {
          body: { action: "confirm_signup", email: email.toLowerCase().trim() },
        });
      } catch (e) {
        console.warn("[useAwaitInlineAuthReady] auth-actions confirm_signup follow-up failed:", e);
      }
      // Сброс таймера, если истекло
      if (state === "expired") {
        readyFiredRef.current = false;
        cancelledRef.current = false;
        startedAtRef.current = Date.now();
        setRemainingMs(WAIT_TIMEOUT_MS);
        setState("waiting_confirm");
        schedulePoll();
        tickTimerRef.current = setInterval(() => {
          const left = Math.max(0, WAIT_TIMEOUT_MS - (Date.now() - startedAtRef.current));
          setRemainingMs(left);
        }, 1000);
        timeoutTimerRef.current = setTimeout(() => {
          if (readyFiredRef.current || cancelledRef.current) return;
          cleanupTimers();
          setState("expired");
          try { onExpiredRef.current?.(); } catch { /* noop */ }
        }, WAIT_TIMEOUT_MS);
      }
      return { ok: true };
    } catch (e: any) {
      setError(e?.message || "resend_failed");
      return { ok: false, error: e?.message };
    }
  }, [email, state, schedulePoll, cleanupTimers]);

  const changeEmail = useCallback(() => {
    cancel();
  }, [cancel]);

  return { state, remainingMs, error, resend, changeEmail, cancel };
}
