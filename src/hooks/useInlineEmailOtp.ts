/**
 * useInlineEmailOtp — OTP-first inline auth for public/identity flows.
 *
 * PATCH-INLINE-AUTH-EMAIL-OTP-FLOW Phase 2.
 *
 * Contract:
 *   1. `sendCode(email, meta?)`   → Supabase `signInWithOtp` (no emailRedirectTo!)
 *                                    metadata is applied on first verify via user_metadata update.
 *   2. `verifyCode(code)`         → `verifyOtp({ type: 'email' })` (staging-proven both signup & magiclink).
 *   3. `resend()`                 → same as sendCode with 60s cooldown.
 *
 * States: email → sent → verifying → authenticated | error.
 *
 * Never logs token/code. Never opens a new tab. Never sets `emailRedirectTo`.
 * `/dashboard` is never involved — session is established in the current window.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type InlineOtpStep =
  | "email"        // Enter email
  | "sent"         // Code sent — enter 6-digit code
  | "authenticated"; // Session active

export interface InlineOtpMeta {
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface UseInlineEmailOtpReturn {
  step: InlineOtpStep;
  email: string;
  isSending: boolean;
  isVerifying: boolean;
  error: string | null;
  invalidAttempts: number;
  /** Seconds remaining before resend is allowed again. 0 = ready. */
  resendIn: number;
  sendCode: (email: string, meta?: InlineOtpMeta) => Promise<boolean>;
  verifyCode: (code: string) => Promise<{ userId: string } | null>;
  resend: () => Promise<boolean>;
  changeEmail: () => void;
  clearError: () => void;
}

const RESEND_COOLDOWN_S = 60;
const FORCE_RESEND_AFTER = 5;

export function useInlineEmailOtp(): UseInlineEmailOtpReturn {
  const [step, setStep] = useState<InlineOtpStep>("email");
  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
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

  const sendOtp = useCallback(async (targetEmail: string, meta?: InlineOtpMeta) => {
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
          // No emailRedirectTo — inline OTP flow stays in the current window.
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
          console.error("[useInlineEmailOtp] sendOtp error:", sendError);
          setError("Не удалось отправить код. Попробуйте ещё раз.");
        }
        return false;
      }

      setEmail(trimmed);
      metaRef.current = meta;
      setStep("sent");
      setInvalidAttempts(0);
      setResendIn(RESEND_COOLDOWN_S);
      return true;
    } catch (e) {
      console.error("[useInlineEmailOtp] sendOtp exception:", e);
      setError("Не удалось отправить код. Попробуйте ещё раз.");
      return false;
    } finally {
      setIsSending(false);
    }
  }, []);

  const sendCode = useCallback(
    (targetEmail: string, meta?: InlineOtpMeta) => sendOtp(targetEmail, meta),
    [sendOtp],
  );

  const resend = useCallback(async () => {
    if (resendIn > 0 || !email) return false;
    return sendOtp(email, metaRef.current);
  }, [email, resendIn, sendOtp]);

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
        // Staging-proven: type='email' works for BOTH signup and magiclink flows.
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

        // Apply metadata (name/phone) once for signup path where verifyOtp does
        // not accept `options.data`. Fire-and-forget — DB trigger has already
        // claimed the profile row.
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
    isVerifying,
    error,
    invalidAttempts,
    resendIn,
    sendCode,
    verifyCode,
    resend,
    changeEmail,
    clearError,
  };
}
