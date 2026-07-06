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

export type InlineOtpStep =
  | "email"
  | "details"
  | "sent"
  | "authenticated";

export interface InlineOtpMeta {
  firstName?: string;
  lastName?: string;
  phone?: string;
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
        const dataPayload = meta
          ? {
              full_name: fullName || undefined,
              first_name: meta.firstName || undefined,
              last_name: meta.lastName || undefined,
              phone: meta.phone || undefined,
            }
          : undefined;

        const { error: sendError } = await supabase.auth.signInWithOtp({
          email: trimmed,
          options: {
            shouldCreateUser: true,
            ...(dataPayload ? { data: dataPayload } : {}),
          },
        });

        if (sendError) {
          const msg = sendError.message || "";
          if (/rate|too many|limit/i.test(msg)) {
            setError("Слишком много попыток. Подождите пару минут и попробуйте снова.");
          } else if (/invalid.*email|email.*invalid/i.test(msg)) {
            setError("Некорректный формат email.");
          } else {
            console.error("[useInlineEmailOtp] signInWithOtp error:", sendError);
            setError(GENERIC_SEND_ERROR);
          }
          return false;
        }

        // Only on success do we advance to the code step.
        setEmail(trimmed);
        if (meta) metaRef.current = meta;
        setStep("sent");
        setInvalidAttempts(0);
        setResendIn(RESEND_COOLDOWN_S);
        return true;
      } catch (e) {
        console.error("[useInlineEmailOtp] signInWithOtp exception:", e);
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
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          email,
          token: cleaned,
          type: "email",
        });

        if (verifyError || !data.session || !data.user) {
          const msg = verifyError?.message || "";
          const next = invalidAttempts + 1;
          setInvalidAttempts(next);
          if (/expired/i.test(msg)) {
            setError("Код истёк. Запросите новый.");
          } else if (/invalid|incorrect|token/i.test(msg)) {
            setError(
              next >= FORCE_RESEND_AFTER
                ? "Слишком много неверных попыток. Запросите новый код."
                : "Неверный код. Проверьте письмо и попробуйте ещё раз.",
            );
          } else if (/rate|too many|limit/i.test(msg)) {
            setError("Слишком много попыток. Подождите и попробуйте снова.");
          } else {
            console.error("[useInlineEmailOtp] verifyOtp error:", verifyError);
            setError("Не удалось подтвердить код. Попробуйте ещё раз.");
          }
          return null;
        }

        // Metadata for new signup path (verifyOtp doesn't accept options.data).
        if (metaRef.current) {
          const meta = metaRef.current;
          const fullName = [meta.firstName, meta.lastName].filter(Boolean).join(" ");
          const payload: Record<string, unknown> = {};
          if (fullName) payload.full_name = fullName;
          if (meta.firstName) payload.first_name = meta.firstName;
          if (meta.lastName) payload.last_name = meta.lastName;
          if (meta.phone) payload.phone = meta.phone;
          if (Object.keys(payload).length > 0) {
            supabase.auth
              .updateUser({ data: payload })
              .catch((e) => console.warn("[useInlineEmailOtp] metadata update failed:", e));
          }
        }

        setStep("authenticated");
        return { userId: data.user.id };
      } catch (e) {
        console.error("[useInlineEmailOtp] verifyOtp exception:", e);
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
