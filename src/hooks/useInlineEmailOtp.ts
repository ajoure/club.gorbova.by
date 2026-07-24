/**
 * useInlineEmailOtp — OTP-first inline auth for public/identity flows.
 *
 * PATCH-INLINE-OTP-FIX-BROKEN-FLOW (2026-07-06):
 *   Fixes production regression where OTP form asked for name/phone from
 *   existing users AND allowed business actions to start without verifyOtp.
 *
 * State machine:
 *   email      → user types email, CTA "Продолжить"
 *     ↓ identify (silent server call — never leaks existence to UI/error)
 *   details    → ONLY for new users / users without profile.full_name.
 *                Collects first/last/phone, CTA "Получить код" → signInWithOtp.
 *   sent       → user enters 6-digit code, verifyOtp('email').
 *   authenticated
 *
 * Hard guarantees:
 *   - `signInWithOtp` is called ONLY from `sendCodeForCurrentEmail`, which
 *     transitions to "sent" ONLY on success. On error we stay put.
 *   - `verifyCode` is the ONLY path that sets step="authenticated".
 *   - No `emailRedirectTo`, no new tab.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRATION_PASSWORD_MIN_LENGTH,
  isRegistrationPasswordValid,
} from "@/lib/auth/registrationPassword";

export type InlineOtpStep =
  | "email"
  | "details"
  | "sent"
  | "authenticated";

export interface InlineOtpMeta {
  firstName?: string;
  lastName?: string;
  phone?: string;
  /**
   * Kept only in browser memory until email OTP verification succeeds.
   * It is never included in the request-inline-otp payload or database row.
   */
  password?: string;
}

interface IdentifyResult {
  exists: boolean;
  hasProfile: boolean;
  needsDetails: boolean;
}

export interface UseInlineEmailOtpReturn {
  step: InlineOtpStep;
  email: string;
  isSending: boolean;
  isIdentifying: boolean;
  isVerifying: boolean;
  error: string | null;
  invalidAttempts: number;
  resendIn: number;
  /** Step 1: submit email; identifies silently, routes to details or sends OTP. */
  submitEmail: (email: string) => Promise<boolean>;
  /** Step 2 (new users only): submit collected meta and send OTP. */
  submitDetails: (meta: InlineOtpMeta) => Promise<boolean>;
  /** Step 3: verify 6-digit OTP; returns { userId } on success. */
  verifyCode: (code: string) => Promise<{ userId: string } | null>;
  /** Resend OTP for the current email (respects cooldown). */
  resend: () => Promise<boolean>;
  /** Return to email step, clear all state. */
  changeEmail: () => void;
  clearError: () => void;
}

const RESEND_COOLDOWN_S = 60;
const FORCE_RESEND_AFTER = 5;
const GENERIC_SEND_ERROR = "Не удалось отправить код. Попробуйте ещё раз.";

export function useInlineEmailOtp(): UseInlineEmailOtpReturn {
  const [step, setStep] = useState<InlineOtpStep>("email");
  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidAttempts, setInvalidAttempts] = useState(0);
  const [resendIn, setResendIn] = useState(0);
  const metaRef = useRef<InlineOtpMeta | undefined>(undefined);
  const pendingPasswordRef = useRef<string | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  const clearError = useCallback(() => setError(null), []);

  const identify = useCallback(async (targetEmail: string): Promise<IdentifyResult> => {
    // Silent identify — errors fall through to "treat as new user" so we never
    // block the flow, and we NEVER surface exists/not-exists to the user.
    try {
      const { data, error: fnError } = await supabase.functions.invoke("auth-check-email", {
        body: { email: targetEmail },
      });
      if (fnError || !data) {
        return { exists: false, hasProfile: false, needsDetails: true };
      }
      const exists = Boolean(data.exists);
      // profile_name coming back means we have a filled profile — no need to
      // re-ask for full name. Phone is optional; if we ever want to require
      // phone-completeness, extend auth-check-email to return `has_phone`.
      const hasProfile = Boolean(data.profile_name);
      return {
        exists,
        hasProfile,
        needsDetails: !(exists && hasProfile),
      };
    } catch (e) {
      console.warn("[useInlineEmailOtp] identify failed, treating as new:", e);
      return { exists: false, hasProfile: false, needsDetails: true };
    }
  }, []);

  const sendOtpForEmail = useCallback(
    async (targetEmail: string, meta?: InlineOtpMeta): Promise<boolean> => {
      setError(null);
      setIsSending(true);
      try {
        const trimmed = targetEmail.toLowerCase().trim();
        const fullName = [meta?.firstName, meta?.lastName].filter(Boolean).join(" ");
        const metaPayload = meta
          ? {
              firstName: meta.firstName || undefined,
              lastName: meta.lastName || undefined,
              fullName: fullName || undefined,
              phone: meta.phone || undefined,
            }
          : undefined;

        const { data, error: sendError } = await supabase.functions.invoke(
          "request-inline-otp",
          {
            body: {
              email: trimmed,
              purpose: "auth",
              meta: metaPayload,
            },
          },
        );

        // functions.invoke surfaces non-2xx as sendError; we also check data.error defensively.
        if (sendError || (data && (data as any).error)) {
          const code = ((data as any)?.error || sendError?.message || "").toString();
          if (/rate_limited|429/i.test(code)) {
            const retry = (data as any)?.retry_after_s;
            setError(
              retry
                ? `Слишком много попыток. Попробуйте через ${retry} с.`
                : "Слишком много попыток. Подождите пару минут и попробуйте снова.",
            );
          } else if (/invalid_email/i.test(code)) {
            setError("Некорректный формат email.");
          } else if (/smtp/i.test(code)) {
            setError("Не удалось отправить письмо. Попробуйте ещё раз через минуту.");
          } else {
            console.error("[useInlineEmailOtp] request-inline-otp error:", sendError, data);
            setError(GENERIC_SEND_ERROR);
          }
          return false;
        }

        // Only on success do we advance to the code step.
        setEmail(trimmed);
        if (meta) {
          metaRef.current = meta;
          pendingPasswordRef.current = meta.password || null;
        }
        setStep("sent");
        setInvalidAttempts(0);
        setResendIn(RESEND_COOLDOWN_S);
        return true;
      } catch (e) {
        console.error("[useInlineEmailOtp] request-inline-otp exception:", e);
        setError(GENERIC_SEND_ERROR);
        return false;
      } finally {
        setIsSending(false);
      }
    },
    [],
  );


  const submitEmail = useCallback(
    async (targetEmail: string): Promise<boolean> => {
      setError(null);
      const trimmed = (targetEmail || "").toLowerCase().trim();
      if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
        setError("Введите корректный email.");
        return false;
      }
      setEmail(trimmed);
      setIsIdentifying(true);
      let identified: IdentifyResult;
      try {
        identified = await identify(trimmed);
      } finally {
        setIsIdentifying(false);
      }

      if (identified.needsDetails) {
        // New user (or legacy profile without full_name) — collect meta first.
        setStep("details");
        return true;
      }
      // Existing user with filled profile — send OTP immediately.
      return sendOtpForEmail(trimmed);
    },
    [identify, sendOtpForEmail],
  );

  const submitDetails = useCallback(
    async (meta: InlineOtpMeta): Promise<boolean> => {
      if (!email) {
        setError("Введите email заново.");
        setStep("email");
        return false;
      }
      if (!meta.password || !isRegistrationPasswordValid(meta.password)) {
        setError(
          `Пароль должен содержать минимум ${REGISTRATION_PASSWORD_MIN_LENGTH} символов, одну букву и одну цифру.`,
        );
        return false;
      }
      return sendOtpForEmail(email, meta);
    },
    [email, sendOtpForEmail],
  );

  const resend = useCallback(async () => {
    if (resendIn > 0 || !email) return false;
    return sendOtpForEmail(email, metaRef.current);
  }, [email, resendIn, sendOtpForEmail]);

  const verifyCode = useCallback(
    async (code: string): Promise<{ userId: string } | null> => {
      setError(null);
      setIsVerifying(true);
      const cleaned = (code || "").replace(/\D/g, "").slice(0, 6);
      try {
        if (cleaned.length !== 6) {
          setError("Введите 6-значный код из письма.");
          return null;
        }

        // Step 1: verify code server-side and mint token_hash.
        const { data: verifyData, error: verifyFnError } = await supabase.functions.invoke(
          "verify-inline-otp",
          { body: { email, code: cleaned } },
        );

        const errCode = ((verifyData as any)?.error || verifyFnError?.message || "").toString();
        if (errCode) {
          const next = invalidAttempts + 1;
          setInvalidAttempts(next);
          if (/expired/i.test(errCode)) {
            setError("Код истёк. Запросите новый.");
          } else if (/locked/i.test(errCode)) {
            setError("Слишком много неверных попыток. Запросите новый код.");
          } else if (/no_active_code/i.test(errCode)) {
            setError("Код не найден. Запросите новый.");
          } else if (/invalid_code/i.test(errCode)) {
            setError(
              next >= FORCE_RESEND_AFTER
                ? "Слишком много неверных попыток. Запросите новый код."
                : "Неверный код. Проверьте письмо и попробуйте ещё раз.",
            );
          } else if (/rate|too_many|limit/i.test(errCode)) {
            setError("Слишком много попыток. Подождите и попробуйте снова.");
          } else {
            console.error("[useInlineEmailOtp] verify-inline-otp error:", verifyFnError, verifyData);
            setError("Не удалось подтвердить код. Попробуйте ещё раз.");
          }
          return null;
        }

        const tokenHash = (verifyData as any)?.token_hash as string | undefined;
        if (!tokenHash) {
          setError("Не удалось подтвердить код. Попробуйте ещё раз.");
          return null;
        }

        // Step 2: exchange token_hash for a real Supabase session.
        const { data: sessionData, error: sessionError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "magiclink",
        });

        if (sessionError || !sessionData?.session || !sessionData?.user) {
          console.error("[useInlineEmailOtp] session exchange failed:", sessionError);
          setError("Не удалось подтвердить код. Попробуйте ещё раз.");
          return null;
        }

        // New registrations keep the password only in browser memory. Set it
        // after the email code has produced a verified Supabase session.
        const pendingPassword = pendingPasswordRef.current;
        if (pendingPassword) {
          const { error: passwordError } = await supabase.auth.updateUser({
            password: pendingPassword,
          });
          if (passwordError) {
            console.error("[useInlineEmailOtp] password setup failed:", passwordError);
            await supabase.auth.signOut();
            setStep("details");
            setError(
              "Email подтверждён, но пароль не удалось сохранить. Проверьте пароль и запросите новый код.",
            );
            return null;
          }
          pendingPasswordRef.current = null;
        }

        setStep("authenticated");
        return { userId: sessionData.user.id };
      } catch (e) {
        console.error("[useInlineEmailOtp] verifyCode exception:", e);
        setError("Не удалось подтвердить код. Попробуйте ещё раз.");
        return null;
      } finally {
        setIsVerifying(false);
      }
    },
    [email, invalidAttempts],
  );


  const changeEmail = useCallback(() => {
    setStep("email");
    setError(null);
    setInvalidAttempts(0);
    setResendIn(0);
    metaRef.current = undefined;
    pendingPasswordRef.current = null;
  }, []);

  return {
    step,
    email,
    isSending,
    isIdentifying,
    isVerifying,
    error,
    invalidAttempts,
    resendIn,
    submitEmail,
    submitDetails,
    verifyCode,
    resend,
    changeEmail,
    clearError,
  };
}
