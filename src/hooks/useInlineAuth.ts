/**
 * Shared inline auth hook — extracted from PaymentDialog.
 * 
 * Provides email-check → login/signup flow reusable across
 * PaymentDialog and site-renderer FormSection (auth_mode).
 * 
 * STOP-guard: This is an add-only extract. PaymentDialog's step contracts,
 * error texts, and UX transitions MUST NOT change when adopting this hook.
 */
import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type InlineAuthStep =
  | "email"               // Initial: enter email
  | "login"               // Existing user: enter password
  | "signup"              // New user: name, phone, password
  | "email_confirm"       // Signup done, waiting for email confirmation
  | "password_reset_sent" // Forgot-password email dispatched (success state)
  | "authenticated";      // Session active

export interface EmailCheckResult {
  exists: boolean;
  has_password?: boolean;
  profile_name?: string;
}

export interface InlineAuthState {
  step: InlineAuthStep;
  isLoading: boolean;
  error: string | null;
  emailCheckResult: EmailCheckResult | null;
}

export interface UseInlineAuthReturn extends InlineAuthState {
  /** Check if email exists in auth system */
  checkEmail: (email: string) => Promise<EmailCheckResult | null>;
  /** Login with email + password */
  login: (email: string, password: string) => Promise<{ userId: string } | null>;
  /** Signup with email + password + metadata */
  signup: (email: string, password: string, meta?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
  }) => Promise<{ userId: string; needsConfirmation: boolean } | null>;
  /** Send password reset email; transitions to password_reset_sent on success. */
  requestPasswordReset: (email: string) => Promise<boolean>;
  /** Reset to email step */
  reset: () => void;
  /** Set step manually (for external flow control) */
  setStep: (step: InlineAuthStep) => void;
  /** Clear error */
  clearError: () => void;
  /** Ref to guard against auth-in-progress race conditions */
  authInProgressRef: React.MutableRefObject<boolean>;
}

export function useInlineAuth(initialStep: InlineAuthStep = "email"): UseInlineAuthReturn {
  const [step, setStep] = useState<InlineAuthStep>(initialStep);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailCheckResult, setEmailCheckResult] = useState<EmailCheckResult | null>(null);
  const authInProgressRef = useRef(false);

  const clearError = useCallback(() => setError(null), []);

  const reset = useCallback(() => {
    setStep("email");
    setError(null);
    setEmailCheckResult(null);
    authInProgressRef.current = false;
  }, []);

  const checkEmail = useCallback(async (email: string): Promise<EmailCheckResult | null> => {
    setError(null);
    setIsLoading(true);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("auth-check-email", {
        body: { email: email.toLowerCase().trim() },
      });

      if (fnError) {
        console.error("Error checking email:", fnError);
        // Fallback: treat as new user
        const fallback: EmailCheckResult = { exists: false };
        setEmailCheckResult(fallback);
        setStep("signup");
        return fallback;
      }

      setEmailCheckResult(data);

      if (data.exists) {
        setStep("login");
      } else {
        setStep("signup");
      }

      return data;
    } catch (err) {
      console.error("Error checking email:", err);
      const fallback: EmailCheckResult = { exists: false };
      setEmailCheckResult(fallback);
      setStep("signup");
      return fallback;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (
    email: string,
    password: string
  ): Promise<{ userId: string } | null> => {
    setError(null);
    setIsLoading(true);

    try {
      authInProgressRef.current = true;

      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password,
      });

      if (authError) {
        authInProgressRef.current = false;
        if (authError.message.includes("Invalid login credentials")) {
          setError("Неверный пароль");
        } else {
          setError(authError.message);
        }
        return null;
      }

      if (data.user) {
        setStep("authenticated");
        return { userId: data.user.id };
      }

      authInProgressRef.current = false;
      return null;
    } catch (err) {
      console.error("Login error:", err);
      authInProgressRef.current = false;
      setError("Произошла ошибка при входе");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signup = useCallback(async (
    email: string,
    password: string,
    meta?: { firstName?: string; lastName?: string; phone?: string }
  ): Promise<{ userId: string; needsConfirmation: boolean } | null> => {
    setError(null);
    setIsLoading(true);

    try {
      authInProgressRef.current = true;

      const fullName = [meta?.firstName, meta?.lastName].filter(Boolean).join(" ");

      const { data, error: authError } = await supabase.auth.signUp({
        email: email.toLowerCase().trim(),
        password,
        options: {
          data: {
            full_name: fullName || undefined,
            first_name: meta?.firstName || undefined,
            last_name: meta?.lastName || undefined,
            phone: meta?.phone || undefined,
          },
          emailRedirectTo: window.location.href,
        },
      });

      if (authError) {
        authInProgressRef.current = false;
        setError(authError.message);
        return null;
      }

      if (data.user) {
        // Check if email confirmation is required
        // If identities array is empty, it means the user needs to confirm
        const needsConfirmation = !data.session;

        if (needsConfirmation) {
          setStep("email_confirm");
          authInProgressRef.current = false;
        } else {
          setStep("authenticated");
        }

        return { userId: data.user.id, needsConfirmation };
      }

      authInProgressRef.current = false;
      return null;
    } catch (err) {
      console.error("Signup error:", err);
      authInProgressRef.current = false;
      setError("Произошла ошибка при регистрации");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string): Promise<boolean> => {
    setError(null);
    const trimmed = (email || "").trim();
    if (!trimmed) {
      setError("Введите email, чтобы восстановить пароль");
      return false;
    }
    setIsLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        trimmed.toLowerCase(),
        { redirectTo: `${window.location.origin}/auth?mode=reset` }
      );
      if (resetError) {
        console.error("Password reset error:", resetError);
        setError("Не удалось отправить письмо. Попробуйте позже.");
        return false;
      }
      setStep("password_reset_sent");
      return true;
    } catch (err) {
      console.error("Password reset exception:", err);
      setError("Не удалось отправить письмо. Попробуйте позже.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    step,
    isLoading,
    error,
    emailCheckResult,
    checkEmail,
    login,
    signup,
    requestPasswordReset,
    reset,
    setStep,
    clearError,
    authInProgressRef,
  };
}
