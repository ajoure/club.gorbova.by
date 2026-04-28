import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, CreditCard, CheckCircle, ShieldCheck, User, KeyRound, MessageCircle, ExternalLink, Mail, Info, AlertTriangle, Repeat, Shield } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { z } from "zod";
import { PhoneInput, isValidPhoneNumber } from "@/components/ui/phone-input";
import { useTelegramLinkStatus, useStartTelegramLink } from "@/hooks/useTelegramLink";
import {
  cancelOldSubscriptionForReplacement,
  type SubscriptionConflictInfo,
} from "@/lib/subscriptionReplacement";

interface SubscriptionMessage {
  title?: string;           // "Ежемесячная подписка" / "Подписка на Клуб"
  description?: string;     // Что пользователь получает
  startDate?: string;       // Дата старта (если есть)
  nextChargeInfo?: string;  // Инфо о следующем списании
}

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  price: string;
  tariffCode?: string;
  offerId?: string;
  isTrial?: boolean;
  trialDays?: number;
  isClubProduct?: boolean;
  isSubscription?: boolean; // True for recurring payments (auto-renewal)
  // Installment offer (payment_method='internal_installment'). Если задано
  // и >=2 — кнопка «Оплатить» создаёт installment payment_link и редиректит на /pay/:token.
  paymentMethod?: string | null;
  installmentCount?: number | null;
  subscriptionMessage?: SubscriptionMessage;
}

const emailSchema = z.string().email("Введите корректный email");
const phoneSchema = z.string().refine((val) => isValidPhoneNumber(val), {
  message: "Введите корректный номер телефона",
});
const passwordSchema = z.string().min(6, "Пароль должен быть не менее 6 символов");

// Translate payment errors to Russian
function translatePaymentError(error: string): string {
  const errorMap: Record<string, string> = {
    'Insufficient funds': 'Недостаточно средств на карте',
    'insufficient_funds': 'Недостаточно средств на карте',
    'Declined': 'Платёж отклонён банком',
    'declined': 'Платёж отклонён банком',
    'Expired card': 'Срок действия карты истёк',
    'expired_card': 'Срок действия карты истёк',
    'Card restricted': 'На карте установлены ограничения',
    'card_restricted': 'На карте установлены ограничения',
    'Transaction not permitted': 'Операция не разрешена для данной карты',
    'transaction_not_permitted': 'Операция не разрешена для данной карты',
    'Invalid amount': 'Неверная сумма платежа',
    'invalid_amount': 'Неверная сумма платежа',
    'Authentication failed': 'Ошибка аутентификации 3D Secure',
    'authentication_failed': 'Ошибка аутентификации 3D Secure',
    '3-D Secure authentication failed': 'Ошибка подтверждения 3D Secure',
    'Payment failed': 'Платёж не прошёл',
    'payment_failed': 'Платёж не прошёл',
    'Token expired': 'Сохранённая карта устарела',
    'token_expired': 'Сохранённая карта устарела',
    'Invalid token': 'Ошибка привязанной карты',
    'invalid_token': 'Ошибка привязанной карты',
    'Do not honor': 'Платёж отклонён банком',
    'do_not_honor': 'Платёж отклонён банком',
    'Lost card': 'Карта заблокирована (утеряна)',
    'lost_card': 'Карта заблокирована (утеряна)',
    'Stolen card': 'Карта заблокирована',
    'stolen_card': 'Карта заблокирована',
    'Invalid card': 'Неверные данные карты',
    'invalid_card': 'Неверные данные карты',
    'Check the account balance': 'Недостаточно средств на карте',
  };

  // Try exact match first
  if (errorMap[error]) return errorMap[error];
  
  // Try case-insensitive partial match
  const lowerError = error.toLowerCase();
  for (const [key, value] of Object.entries(errorMap)) {
    if (lowerError.includes(key.toLowerCase())) return value;
  }
  
  // Return default message if no translation found
  return "Не удалось провести платёж. Попробуйте другую карту.";
}

interface UserFormData {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  password: string;
}

type Step = "email" | "login" | "additional_info" | "telegram_prompt" | "processing" | "ready";
type PaymentFlowType = 'mit' | 'provider_managed';

interface EmailCheckResult {
  exists: boolean;
  hasPassword: boolean;
  maskedName?: string;
}

export function PaymentDialog({
  open,
  onOpenChange,
  productId,
  productName,
  price,
  tariffCode,
  offerId,
  isTrial,
  trialDays,
  isClubProduct,
  isSubscription,
  paymentMethod,
  installmentCount,
  subscriptionMessage,
}: PaymentDialogProps) {
  const { user, session } = useAuth();
  const { isSuperAdmin, isAdmin } = usePermissions();
  const [step, setStep] = useState<Step>("email");
  // PAY-K UX: granular processing stage for clearer feedback during saved-card flow.
  const [processingStage, setProcessingStage] = useState<'preparing' | 'creating_order' | 'charging_card' | 'redirecting_3ds'>('preparing');
  const [isTestPaymentLoading, setIsTestPaymentLoading] = useState(false);
  const [formData, setFormData] = useState<UserFormData>({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<UserFormData>>({});
  const [existingUserId, setExistingUserId] = useState<string | null>(null);
  const [emailCheckResult, setEmailCheckResult] = useState<EmailCheckResult | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  // PAY-I: список сохранённых карт; всегда disabled в PaymentDialog (см. mem://ui/payments/saved-card-client-policy).
  const [savedCards, setSavedCards] = useState<Array<{ id: string; brand: string; last4: string; exp_month: number | null; exp_year: number | null; is_default: boolean }>>([]);
  const [isLoadingCard, setIsLoadingCard] = useState(false);
  // Backwards-compatible alias for legacy error-message branch (handlePayment не меняется).
  const savedCard = savedCards[0] ?? null;
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [telegramDeepLink, setTelegramDeepLink] = useState<string | null>(null);
  const [showTrialUsedModal, setShowTrialUsedModal] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentFlowType, setPaymentFlowType] = useState<PaymentFlowType>('provider_managed');

  // PAY-K: one_time saved-card selector. 'new_card' or payment_method_id (uuid).
  // Для subscription/trial карты остаются disabled (PAY-I behavior).
  const [selectedMethod, setSelectedMethod] = useState<string>('new_card');
  const savedCardIdempotencyKeyRef = useRef<string>(crypto.randomUUID());

  // Same-pair subscription conflict (existing active subscription on same product+tariff)
  const [conflictData, setConflictData] = useState<SubscriptionConflictInfo | null>(null);
  const [replaceStep, setReplaceStep] = useState<'idle' | 'cancelling' | 'creating'>('idle');
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  // Telegram link hooks
  const { data: telegramStatus, refetch: refetchTelegramStatus, isLoading: isTelegramStatusLoading } = useTelegramLinkStatus();
  const startTelegramLink = useStartTelegramLink();

  // Check if telegram is already linked
  const isTelegramLinked = telegramStatus?.status === 'active';

  // Ref to prevent useEffect from resetting state after inline auth
  const authInProgressRef = useRef(false);

  // PAY-I: грузим список активных bePaid-карт. Селектим только нечувствительные поля.
  const loadSavedCards = async (userId: string) => {
    setIsLoadingCard(true);
    try {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("id, brand, last4, exp_month, exp_year, is_default")
        .eq("user_id", userId)
        .eq("status", "active")
        .eq("provider", "bepaid")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[PaymentDialog] loadSavedCards failed:", error);
        return;
      }
      setSavedCards(
        (data ?? []).map((c) => ({
          id: c.id,
          brand: c.brand || "",
          last4: c.last4 || "",
          exp_month: c.exp_month ?? null,
          exp_year: c.exp_year ?? null,
          is_default: !!c.is_default,
        }))
      );
    } catch (err) {
      console.error("[PaymentDialog] loadSavedCards exception:", err);
    } finally {
      setIsLoadingCard(false);
    }
  };

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      // After inline auth: user/session changed but dialog should stay on current step
      if (authInProgressRef.current && user && session) {
        authInProgressRef.current = false;
        setExistingUserId(user.id);
        loadSavedCards(user.id);
        return; // Skip full reset — keep formData, step, selectedOffer intact
      }

      setSavedCards([]);
      setIsLoadingCard(false);
      setSelectedMethod('new_card');
      savedCardIdempotencyKeyRef.current = crypto.randomUUID();
      setTelegramDeepLink(null);
      setShowTrialUsedModal(false);
      setPaymentError(null);
      setConflictData(null);
      setReplaceStep('idle');
      setShowReplaceConfirm(false);
      if (user && session) {
        // User is authenticated - use their data
        setFormData({
          email: user.email || "",
          firstName: user.user_metadata?.full_name?.split(" ")[0] || "",
          lastName: user.user_metadata?.full_name?.split(" ").slice(1).join(" ") || "",
          phone: user.user_metadata?.phone || "",
          password: "",
        });
        setExistingUserId(user.id);
        
        // For club products without linked Telegram, show telegram prompt first
        // But only if telegram status is loaded and not active
        if (isClubProduct && !isTelegramStatusLoading && !isTelegramLinked) {
          setStep("telegram_prompt");
        } else {
          setStep("ready");
        }
        
        // Check for saved payment method
        loadSavedCards(user.id);
      } else {
        // User is not authenticated - start with email step
        setFormData({ email: "", firstName: "", lastName: "", phone: "+375", password: "" });
        setExistingUserId(null);
        setStep("email");
      }
      setErrors({});
      setEmailCheckResult(null);
      setLoginError(null);
      setPrivacyConsent(false);
    } else {
      // Dialog closed — always reset authInProgressRef
      authInProgressRef.current = false;
      setPaymentError(null);
    }
  }, [open, user, session, isClubProduct, isTelegramLinked, isTelegramStatusLoading]);

  // PAY-K: для one_time — выставить дефолтную сохранённую карту, иначе 'new_card'.
  // Для subscription/trial — всегда 'new_card' (карты disabled, PAY-I behavior).
  const isOneTimeFlow = !isSubscription && !isTrial;
  useEffect(() => {
    if (!isOneTimeFlow || savedCards.length === 0) {
      if (selectedMethod !== 'new_card') setSelectedMethod('new_card');
      return;
    }
    if (selectedMethod !== 'new_card' && savedCards.some((c) => c.id === selectedMethod)) return;
    const def = savedCards.find((c) => c.is_default) || savedCards[0];
    setSelectedMethod(def?.id || 'new_card');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOneTimeFlow, savedCards]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setLoginError(null);

    const validation = emailSchema.safeParse(formData.email);
    if (!validation.success) {
      setErrors({ email: validation.error.errors[0].message });
      return;
    }

    setIsLoading(true);

    try {
      // Call edge function to check email
      const { data, error } = await supabase.functions.invoke("auth-check-email", {
        body: { email: formData.email.toLowerCase().trim() },
      });

      if (error) {
        console.error("Error checking email:", error);
        // Fallback to old behavior on error
        setStep("additional_info");
        return;
      }

      setEmailCheckResult(data);

      if (data.exists) {
        // User exists - show login step
        setStep("login");
      } else {
        // New user - collect info
        setStep("additional_info");
      }
    } catch (error) {
      console.error("Error checking email:", error);
      // On error, proceed to collect all info
      setStep("additional_info");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setErrors({});

    const passwordValidation = passwordSchema.safeParse(formData.password);
    if (!passwordValidation.success) {
      setErrors({ password: passwordValidation.error.errors[0].message });
      return;
    }

    setIsLoading(true);

    try {
      // Set flag BEFORE auth to prevent useEffect from resetting dialog state
      authInProgressRef.current = true;

      const { data, error } = await supabase.auth.signInWithPassword({
        email: formData.email.toLowerCase().trim(),
        password: formData.password,
      });

      if (error) {
        // Auth failed — reset flag so useEffect works normally
        authInProgressRef.current = false;
        if (error.message.includes("Invalid login credentials")) {
          setLoginError("Неверный пароль");
        } else {
          setLoginError(error.message);
        }
        return;
      }

      if (data.user) {
        // Successfully logged in
        setExistingUserId(data.user.id);
        
        // Get profile data
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, phone")
          .eq("user_id", data.user.id)
          .maybeSingle();

        if (profile) {
          const nameParts = profile.full_name?.split(" ") || [];
          setFormData(prev => ({
            ...prev,
            firstName: nameParts[0] || "",
            lastName: nameParts.slice(1).join(" ") || "",
            phone: profile.phone || "",
          }));
        }

        toast.success("Вход выполнен успешно");
        
        // Refresh telegram status and check if prompt needed
        await refetchTelegramStatus();
        
        // For club products without linked Telegram, show telegram prompt
        if (isClubProduct) {
          const { data: freshProfile } = await supabase
            .from("profiles")
            .select("telegram_link_status")
            .eq("user_id", data.user.id)
            .maybeSingle();
          
          if (freshProfile?.telegram_link_status !== 'active') {
            setStep("telegram_prompt");
            return;
          }
        }
        
        setStep("ready");
      }
    } catch (error) {
      console.error("Login error:", error);
      authInProgressRef.current = false;
      setLoginError("Произошла ошибка при входе");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setIsLoading(true);
    setLoginError(null);

    try {
      // Use custom auth-actions edge function (same as Auth.tsx)
      const { data, error } = await supabase.functions.invoke("auth-actions", {
        body: {
          action: "reset_password",
          email: formData.email.toLowerCase().trim(),
        },
      });

      if (error || (data && typeof data === "object" && "error" in data)) {
        setLoginError("Ошибка отправки письма. Попробуйте позже.");
      } else {
        toast.success("Письмо для восстановления пароля отправлено на ваш email");
      }
    } catch (error) {
      console.error("Password reset error:", error);
      setLoginError("Ошибка отправки письма");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdditionalInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Partial<UserFormData> = {};

    if (!formData.firstName.trim() || formData.firstName.trim().length < 2) {
      newErrors.firstName = "Имя должно содержать минимум 2 символа";
    }
    if (!formData.lastName.trim() || formData.lastName.trim().length < 2) {
      newErrors.lastName = "Фамилия должна содержать минимум 2 символа";
    }
    const phoneValidation = phoneSchema.safeParse(formData.phone);
    if (!phoneValidation.success) {
      newErrors.phone = phoneValidation.error.errors[0].message;
    }

    if (!privacyConsent) {
      toast.error("Необходимо согласиться с Политикой конфиденциальности");
      return;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // For club products (new user flow), show telegram prompt only if not already linked
    if (isClubProduct && !isTelegramLinked) {
      setStep("telegram_prompt");
    } else {
      setStep("ready");
    }
  };

  // Handle starting Telegram link
  const handleStartTelegramLink = async () => {
    try {
      const result = await startTelegramLink.mutateAsync();
      if (result.deep_link) {
        setTelegramDeepLink(result.deep_link);
        window.open(result.deep_link, "_blank");
      }
    } catch (error) {
      console.error("Failed to start Telegram link:", error);
    }
  };

  // Handle skipping Telegram link
  const handleSkipTelegramLink = () => {
    setStep("ready");
  };

  // Helper: invoke subscription checkout, optionally as replacement of existing same-pair sub
  const invokeProviderManagedCheckout = async (replacementOfSubscriptionV2Id?: string) => {
    return await supabase.functions.invoke("bepaid-create-subscription-checkout", {
      body: {
        productId,
        tariffCode,
        offerId,
        customerEmail: formData.email,
        customerPhone: formData.phone,
        customerFirstName: formData.firstName,
        customerLastName: formData.lastName,
        existingUserId,
        explicit_user_choice: true,
        ...(replacementOfSubscriptionV2Id
          ? { replacement_of_subscription_v2_id: replacementOfSubscriptionV2Id }
          : {}),
      },
    });
  };

  const handleReplaceSubscription = async () => {
    if (!conflictData) return;
    setShowReplaceConfirm(false);
    setIsLoading(true);
    setPaymentError(null);
    setStep("processing");
    try {
      setReplaceStep('cancelling');
      await cancelOldSubscriptionForReplacement({
        conflict: conflictData,
        source: 'public_checkout_replace',
        targetUserId: existingUserId,
      });

      setReplaceStep('creating');
      const { data, error } = await invokeProviderManagedCheckout(conflictData.subscription_v2_id);
      if (error) throw new Error(data?.error || error.message);
      if (!data?.success) throw new Error(data?.error || 'Ошибка создания новой подписки');

      if (data.redirect_url) {
        window.location.href = data.redirect_url;
        return;
      }
      throw new Error('Не удалось получить ссылку на оплату.');
    } catch (e) {
      console.error('[PaymentDialog] replace flow failed', e);
      const message = e instanceof Error ? e.message : 'Не удалось заменить подписку';
      setPaymentError(message);
      toast.error(message);
      setReplaceStep('idle');
      setStep('ready');
    } finally {
      setIsLoading(false);
    }
  };

  // PAY-K: parse `price` ("100 BYN" / "100.00 BYN") to kopecks for expected_amount guard.
  const parsePriceToKopecks = (raw: string): number | null => {
    if (!raw) return null;
    const m = raw.replace(',', '.').match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const byn = parseFloat(m[1]);
    if (!Number.isFinite(byn) || byn <= 0) return null;
    return Math.round(byn * 100);
  };

  // PAY-K: одноразовая оплата сохранённой картой через bridge → public-charge-saved-card.
  const handlePayWithSavedCardOneTime = async (paymentMethodId: string) => {
    if (!user || !session) {
      setPaymentError('Войдите в аккаунт, чтобы использовать сохранённую карту.');
      setStep('ready');
      return;
    }
    const expected_amount = parsePriceToKopecks(price);
    if (!expected_amount) {
      setPaymentError('Не удалось определить сумму платежа.');
      setStep('ready');
      return;
    }
    setIsLoading(true);
    setPaymentError(null);
    setProcessingStage('creating_order');
    setStep('processing');
    try {
      // 1. Bridge: create internal one-time payment_link.
      const { data: bridgeData, error: bridgeError } = await supabase.functions.invoke(
        'payment-dialog-create-bridge-link',
        {
          body: {
            product_id: productId,
            tariff_code: tariffCode || null,
            offer_id: offerId || null,
            expected_amount,
            currency: 'BYN',
            description: productName,
          },
        }
      );
      if (bridgeError || !bridgeData?.success || !bridgeData?.url_token) {
        const msg = bridgeData?.error || bridgeError?.message || 'Не удалось подготовить оплату';
        if (msg === 'price_mismatch') {
          throw new Error('Стоимость изменилась. Обновите страницу и попробуйте снова.');
        }
        throw new Error(msg);
      }

      // 2. Charge saved card via existing public-charge-saved-card.
      setProcessingStage('charging_card');
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const chargeUrl = `https://${projectId}.supabase.co/functions/v1/public-charge-saved-card`;
      const idempotency_key = savedCardIdempotencyKeyRef.current;
      const res = await fetch(chargeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          url_token: bridgeData.url_token,
          payment_method_id: paymentMethodId,
          idempotency_key,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        setPaymentError(data?.message || 'Платёж уже создан. Завершите подтверждение или попробуйте позже.');
        setStep('ready');
        return;
      }
      if (!res.ok || !data?.success) {
        const errMsg = data?.message || data?.error || 'Не удалось списать сохранённую карту';
        throw new Error(translatePaymentError(String(errMsg)));
      }
      // Issuer 3DS may require extra confirmation.
      if (data.redirect_url) {
        setProcessingStage('redirecting_3ds');
        window.location.href = data.redirect_url;
        return;
      }
      window.location.href = `/purchases?order=${data.order_id}&payment=processing`;
    } catch (err) {
      console.error('[PaymentDialog] saved-card one-time charge failed:', err);
      const message = err instanceof Error ? err.message : normalizeEdgeFunctionError(err);
      setPaymentError(message);
      toast.error(message);
      setStep('ready');
    } finally {
      setIsLoading(false);
    }
  };

  // F3: рассрочка с лендинга. Создаём public payment_link через
  // public-create-installment-link и редиректим на /pay/:token. Дальше уже
  // работает существующий public-checkout → bepaid → installment_payments.
  const isInstallmentOffer =
    paymentMethod === 'internal_installment' &&
    typeof installmentCount === 'number' &&
    installmentCount >= 2 &&
    !isTrial &&
    !isSubscription;

  const handleInstallmentPayment = async () => {
    if (!offerId) {
      setPaymentError('Не удалось определить оффер рассрочки.');
      setStep('ready');
      return;
    }
    setIsLoading(true);
    setPaymentError(null);
    setStep('processing');
    try {
      const { data, error } = await supabase.functions.invoke(
        'public-create-installment-link',
        { body: { product_id: productId, offer_id: offerId } }
      );
      if (error || !data?.success || !data?.url_token) {
        const msg = data?.error || error?.message || 'Не удалось создать ссылку на рассрочку';
        throw new Error(msg);
      }
      // Редирект на canonical /pay/:token (домен из public_url продукта).
      const target = data.public_url || `/pay/${data.url_token}`;
      window.location.href = target;
    } catch (err) {
      console.error('[PaymentDialog] installment link create failed:', err);
      const message = err instanceof Error ? err.message : normalizeEdgeFunctionError(err);
      setPaymentError(message);
      toast.error(message);
      setStep('ready');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePayment = async () => {
    // F3: installment-оффер → отдельный path через payment_links.
    if (isInstallmentOffer) {
      await handleInstallmentPayment();
      return;
    }

    // PAY-K: для one_time + saved card → bridge flow; new_card продолжает обычный путь.
    if (!isSubscription && !isTrial && selectedMethod !== 'new_card') {
      await handlePayWithSavedCardOneTime(selectedMethod);
      return;
    }

    setIsLoading(true);
    setPaymentError(null);
    setConflictData(null);
    setReplaceStep('idle');
    setShowReplaceConfirm(false);
    setStep("processing");

    console.log("handlePayment called", { savedCard, tariffCode, user: !!user, productId, paymentFlowType, selectedMethod, isInstallmentOffer });

    try {
      // PATCH-3: If user selected provider_managed flow - no savedCard restriction
      // This explicitly creates a bePaid subscription (provider-managed recurring)
      if (paymentFlowType === 'provider_managed' && isSubscription && !isTrial) {
        console.log("Using provider_managed flow (bePaid subscription checkout) - explicit user choice");
        const { data, error } = await invokeProviderManagedCheckout();

        if (error) {
          if (data?.alreadyUsedTrial) {
            setShowTrialUsedModal(true);
            setStep("ready");
            setIsLoading(false);
            return;
          }
          // Same-pair subscription conflict — show keep/replace UI, do NOT redirect to /purchases
          if (data?.error === 'existing_subscription_conflict' && data?.conflict) {
            setConflictData(data.conflict as SubscriptionConflictInfo);
            setStep('ready');
            setIsLoading(false);
            return;
          }
          throw new Error(data?.error || error.message);
        }

        if (!data.success) {
          if (data?.error === 'existing_subscription_conflict' && data?.conflict) {
            setConflictData(data.conflict as SubscriptionConflictInfo);
            setStep('ready');
            setIsLoading(false);
            return;
          }
          throw new Error(data.error || "Ошибка создания подписки bePaid");
        }

        // Redirect to bePaid subscription checkout page
        if (data.redirect_url) {
          window.location.href = data.redirect_url;
        } else {
          const message = "Не удалось получить ссылку на оплату.";
          setPaymentError(message);
          toast.error(message);
          setStep("ready");
        }
        return;
      }

      // CLIENT FLOW: never call direct-charge from client UI.
      // direct-charge is an MIT server-initiated payment and must only be used by admin flows.
      // Even if savedCard exists, client always goes through standard checkout with 3DS.

      // Default: redirect to bePaid checkout
      // MIT tokenization disabled in client flow — subscriptions always use provider_managed (SBS)
      const shouldUseMitTokenization = false;
      
      console.log("Using bepaid-create-token with:", { 
        paymentFlowType, 
        isSubscription, 
        isTrial, 
        useMitTokenization: shouldUseMitTokenization 
      });
      
      // P0: For non-subscription, non-trial products (e.g. consultations), use one-time checkout
      const isOneTimePayment = !isSubscription && !isTrial;

      const { data, error } = await supabase.functions.invoke("bepaid-create-token", {
        body: {
          productId,
          customerEmail: formData.email,
          customerPhone: formData.phone,
          customerFirstName: formData.firstName,
          customerLastName: formData.lastName,
          existingUserId,
          description: productName,
          tariffCode,
          offerId,
          isTrial,
          trialDays,
          isOneTime: isOneTimePayment,
          // PATCH-3: Signal MIT flow to avoid creating bePaid subscription
          useMitTokenization: shouldUseMitTokenization,
        },
      });

      if (error) {
        // Supabase functions.invoke returns response body in `data` even for non-2xx
        if (data?.alreadyUsedTrial) {
          setShowTrialUsedModal(true);
          setStep("ready");
          setIsLoading(false);
          return;
        }

        throw new Error(data?.error || error.message);
      }

      if (!data.success) {
        if (data.alreadyUsedTrial) {
          setShowTrialUsedModal(true);
          setStep("ready");
          setIsLoading(false);
          return;
        }

        const fallbackMessage = isOneTimePayment
          ? "Не удалось открыть страницу оплаты. Попробуйте ещё раз."
          : "Не удалось продолжить оплату. Попробуйте ещё раз или оплатите другой картой.";

        if (data?.fallback) {
          setPaymentError(fallbackMessage);
          toast.error(fallbackMessage);
          setStep("ready");
          return;
        }

        throw new Error(data.error || "Ошибка создания платежа");
      }

      // Redirect to bePaid checkout page
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        const message = "Не удалось получить ссылку на оплату";
        setPaymentError(message);
        toast.error(message);
        setStep("ready");
      }
    } catch (error) {
      console.error("Payment error:", error);
      const isOneTime = !isSubscription && !isTrial;
      const message = isOneTime
        ? "Не удалось открыть страницу оплаты. Попробуйте ещё раз."
        : savedCard
          ? "Не удалось продолжить оплату. Попробуйте ещё раз или оплатите другой картой."
          : normalizeEdgeFunctionError(error);
      setPaymentError(message);
      toast.error(message);
      setStep("ready");
    } finally {
      setIsLoading(false);
    }
  };

  // Admin test payment - SECURITY: only super_admin can use this
  const handleTestPayment = async () => {
    if (!isSuperAdmin()) {
      toast.error("Только super admin может использовать эту функцию");
      return;
    }

    setIsTestPaymentLoading(true);
    try {
      const { data: createData, error: createError } = await supabase.functions.invoke("bepaid-create-token", {
        body: {
          productId,
          customerEmail: formData.email,
          customerPhone: formData.phone,
          customerFirstName: formData.firstName,
          customerLastName: formData.lastName,
          existingUserId,
          description: productName,
          tariffCode,
          offerId,
          isTrial,
          trialDays,
          skipRedirect: true,
        },
      });

      // Note: Supabase functions.invoke returns the response body in `data` even for non-2xx status codes
      // The `error` only indicates that a non-2xx status was returned
      if (createError || !createData?.success) {
        // Handle already used trial case gracefully
        if (createData?.alreadyUsedTrial) {
          setShowTrialUsedModal(true);
          return;
        }

        throw new Error(
          createData?.error ||
            createError?.message ||
            "Ошибка создания заказа"
        );
      }

      const orderId = createData.orderId;
      if (!orderId) {
        throw new Error("Не удалось получить ID заказа");
      }

      const { data, error } = await supabase.functions.invoke("test-payment-complete", {
        body: { orderId },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data.success) {
        throw new Error(data.error || "Ошибка симуляции оплаты");
      }

      const results = data.results || {};
      const successDetails: string[] = [];
      
      if (results.order_updated) successDetails.push("✓ Заказ обновлён");
      if (results.entitlement_created) successDetails.push("✓ Доступ предоставлен");
      if (results.subscription_updated) successDetails.push("✓ Подписка активирована");
      if (results.telegram_access_granted > 0) {
        successDetails.push(`✓ Telegram: доступ к ${results.telegram_access_granted} клуб(ам)`);
      }
      if (results.getcourse_sync === "success") {
        successDetails.push(`✓ GetCourse: сделка #${results.getcourse_deal_id || 'создана'}`);
      } else if (results.getcourse_sync === "skipped") {
        successDetails.push("⏭ GetCourse: пропущено");
      } else if (results.getcourse_sync === "failed") {
        successDetails.push("⚠ GetCourse: ошибка синхронизации");
      }

      toast.success(
        <div className="space-y-2">
          <div className="font-semibold">Тестовая оплата выполнена!</div>
          <div className="text-sm space-y-1">
            {successDetails.map((detail, i) => (
              <div key={i}>{detail}</div>
            ))}
          </div>
        </div>,
        { duration: 8000 }
      );
      
      onOpenChange(false);
      // Redirect to purchases with payment success params so GlobalPaymentHandler shows the success modal
      window.location.href = `/purchases?payment=success&order=${orderId}`;
    } catch (error) {
      console.error("Test payment error:", error);
      toast.error(
        <div className="space-y-1">
          <div className="font-semibold">Ошибка тестовой оплаты</div>
          <div className="text-sm">{error instanceof Error ? error.message : "Неизвестная ошибка"}</div>
        </div>,
        { duration: 6000 }
      );
    } finally {
      setIsTestPaymentLoading(false);
    }
  };


  const handleChangeEmail = () => {
    setFormData(prev => ({ ...prev, password: "" }));
    setEmailCheckResult(null);
    setLoginError(null);
    setPaymentError(null);
    setConflictData(null);
    setReplaceStep('idle');
    setShowReplaceConfirm(false);
    setErrors({});
    setStep("email");
  };

  const renderStep = () => {
    switch (step) {
      case "email":
        return (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                value={formData.email}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, email: e.target.value }));
                  setErrors(prev => ({ ...prev, email: undefined }));
                }}
                required
                disabled={isLoading}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
                className="flex-1"
              >
                Отмена
              </Button>
              <Button type="submit" disabled={isLoading} className="flex-1">
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Продолжить
              </Button>
            </div>
          </form>
        );

      case "login":
        return (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            {/* Show account info */}
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <User className="h-5 w-5" />
                <span className="font-medium">Это ваш аккаунт</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {emailCheckResult?.maskedName 
                  ? `${emailCheckResult.maskedName}, введите пароль, чтобы продолжить оплату`
                  : "Введите пароль, чтобы продолжить оплату"
                }
              </p>
            </div>

            <div className="rounded-xl bg-card/60 backdrop-blur-sm border border-border/40 p-3 text-sm">
              <p className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-primary" />
                Email: {formData.email}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="dialog_auth_password"
                name="dialog_auth_password"
                type="password"
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, password: e.target.value }));
                  setErrors(prev => ({ ...prev, password: undefined }));
                  setLoginError(null);
                }}
                required
                disabled={isLoading}
                allowAutofill
                autoComplete="current-password"
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password}</p>
              )}
              {loginError && (
                <p className="text-sm text-destructive">{loginError}</p>
              )}
            </div>

            <button
              type="button"
              onClick={handleForgotPassword}
              className="text-sm text-primary hover:underline"
              disabled={isLoading}
            >
              Забыли пароль?
            </button>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleChangeEmail}
                disabled={isLoading}
                className="flex-1"
              >
                Изменить email
              </Button>
              <Button type="submit" disabled={isLoading} className="flex-1">
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="mr-2 h-4 w-4" />
                )}
                Войти и продолжить
              </Button>
            </div>
          </form>
        );

      case "additional_info":
        return (
          <form onSubmit={handleAdditionalInfoSubmit} className="space-y-5">
            <div className="rounded-xl bg-card/60 backdrop-blur-sm border border-border/40 p-3 text-sm">
              <p className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-primary" />
                Email: {formData.email}
              </p>
            </div>

            <div className="rounded-xl bg-card/50 backdrop-blur-sm border border-border/30 p-3 space-y-1.5">
              <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Info className="h-4 w-4 text-primary" />
                Зачем эти данные?
              </p>
              <ul className="text-xs text-muted-foreground space-y-0.5 pl-5 list-disc">
                <li>Email — для личного кабинета, доступов и уведомлений по покупке</li>
                <li>Телефон — для связи по заказу и восстановления доступа</li>
                <li>Имя и фамилия — для оформления покупки и документов</li>
              </ul>
            </div>

            {/* Name fields in row with icons */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">Имя</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="firstName"
                    placeholder="Иван"
                    value={formData.firstName}
                    onChange={(e) => {
                      setFormData(prev => ({ ...prev, firstName: e.target.value }));
                      setErrors(prev => ({ ...prev, firstName: undefined }));
                    }}
                    className={`pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary ${errors.firstName ? 'border-destructive' : ''}`}
                    disabled={isLoading}
                  />
                </div>
                {errors.firstName && (
                  <p className="text-sm text-destructive">{errors.firstName}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Фамилия</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="lastName"
                    placeholder="Иванов"
                    value={formData.lastName}
                    onChange={(e) => {
                      setFormData(prev => ({ ...prev, lastName: e.target.value }));
                      setErrors(prev => ({ ...prev, lastName: undefined }));
                    }}
                    className={`pl-10 h-12 rounded-xl bg-background/50 border-border/50 focus:border-primary ${errors.lastName ? 'border-destructive' : ''}`}
                    disabled={isLoading}
                  />
                </div>
                {errors.lastName && (
                  <p className="text-sm text-destructive">{errors.lastName}</p>
                )}
              </div>
            </div>

            {/* Phone with country selector */}
            <div className="space-y-2">
              <Label htmlFor="phone">Телефон</Label>
              <PhoneInput
                id="phone"
                value={formData.phone}
                onChange={(value) => {
                  setFormData(prev => ({ ...prev, phone: value }));
                  setErrors(prev => ({ ...prev, phone: undefined }));
                }}
                placeholder="Номер телефона"
                error={!!errors.phone}
              />
              {errors.phone && (
                <p className="text-sm text-destructive">{errors.phone}</p>
              )}
            </div>

            <div className="rounded-xl bg-card/60 backdrop-blur-sm border border-border/40 p-3 text-sm text-muted-foreground">
              <p>После оплаты мы создадим для вас личный кабинет и отправим данные для входа на указанный email.</p>
            </div>

            {/* Privacy consent checkbox */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-card/60 backdrop-blur-sm border border-border/40">
              <Checkbox
                id="payment-privacy-consent"
                checked={privacyConsent}
                onCheckedChange={(checked) => setPrivacyConsent(!!checked)}
                className="mt-0.5"
              />
              <Label htmlFor="payment-privacy-consent" className="text-sm leading-snug cursor-pointer">
                Я согласен(на) с{" "}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Политикой конфиденциальности
                </a>{" "}
                и даю{" "}
                <a href="/consent" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  согласие
                </a>{" "}
                на обработку персональных данных
              </Label>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleChangeEmail}
                disabled={isLoading}
                className="flex-1"
              >
                Назад
              </Button>
              <Button type="submit" disabled={isLoading || !privacyConsent} className="flex-1">
                Продолжить
              </Button>
            </div>
          </form>
        );

      case "telegram_prompt":
        return (
          <div className="space-y-4">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-4 space-y-3">
              <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
                <MessageCircle className="h-5 w-5" />
                <span className="font-medium">Доступы отправляются через Telegram</span>
              </div>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Ссылки на чат и канал клуба придут в Telegram. Без привязки Telegram доступ не будет выдан.
              </p>
            </div>

            {telegramDeepLink ? (
              <div className="rounded-xl bg-card/60 backdrop-blur-sm border border-border/40 p-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Бот открыт в новой вкладке. Нажмите "Start" в Telegram, затем вернитесь сюда.
                </p>
                <Button
                  onClick={async () => {
                    await refetchTelegramStatus();
                    if (telegramStatus?.status === 'active') {
                      toast.success("Telegram успешно привязан!");
                      setStep("ready");
                    } else {
                      toast.info("Telegram ещё не привязан. Нажмите Start в боте.");
                    }
                  }}
                  variant="outline"
                  className="w-full"
                  disabled={startTelegramLink.isPending}
                >
                  {startTelegramLink.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Проверить привязку
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleStartTelegramLink}
                className="w-full gap-2"
                disabled={startTelegramLink.isPending}
              >
                {startTelegramLink.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                Привязать Telegram сейчас
              </Button>
            )}

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border/50" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">или</span>
              </div>
            </div>

            <Button
              onClick={handleSkipTelegramLink}
              variant="ghost"
              className="w-full text-muted-foreground"
            >
              Пропустить и продолжить
            </Button>

            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-300">
              Если пропустите — привяжите Telegram позже в личном кабинете, ссылки придут автоматически.
            </div>
          </div>
        );

      case "ready":
        return (
          <div className="space-y-4">
            {isTrial && (
              <Alert className="bg-card/60 backdrop-blur-sm border-border/40">
                <Info className="h-4 w-4" />
                <AlertTitle>Важное о пробном периоде</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Пробный доступ стоит 1 BYN и действует 5 дней</li>
                    <li>Карта понадобится только для автоматического продления после окончания триала. Сохранять её — добровольно: при желании вы можете оплатить полную стоимость подписки сразу без сохранения карты.</li>
                    <li>По завершении пробного периода оплата будет автоматически списана по выбранному тарифу</li>
                    <li>Вы можете в любой момент отменить подписку в личном кабинете</li>
                    <li>В случае отмены доступ сохраняется до окончания уже оплаченного периода</li>
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {paymentError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Не удалось продолжить оплату</AlertTitle>
                <AlertDescription>{paymentError}</AlertDescription>
              </Alert>
            )}

            {conflictData && conflictData.product_id === productId && isSubscription && !isTrial && (
              <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                <Repeat className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-800 dark:text-amber-200">
                  У вас уже есть активная подписка на этот продукт
                </AlertTitle>
                <AlertDescription className="space-y-3">
                  <div className="text-sm space-y-1 text-amber-800 dark:text-amber-200">
                    <p>Статус: {conflictData.status}</p>
                    {conflictData.access_end_at && (
                      <p>
                        Доступ до:{" "}
                        {new Date(conflictData.access_end_at).toLocaleString("ru-RU", {
                          timeZone: conflictData.timezone_used || "Europe/Minsk",
                        })}
                      </p>
                    )}
                    {conflictData.next_charge_at && (
                      <p>
                        Следующее списание:{" "}
                        {new Date(conflictData.next_charge_at).toLocaleString("ru-RU", {
                          timeZone: conflictData.timezone_used || "Europe/Minsk",
                        })}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 w-full">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setConflictData(null);
                        onOpenChange(false);
                      }}
                      className="w-full min-w-0"
                    >
                      <span className="truncate">Оставить текущую</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setShowReplaceConfirm(true)}
                      disabled={isLoading}
                      className="w-full min-w-0"
                    >
                      <Repeat className="mr-2 h-4 w-4 shrink-0" />
                      <span className="truncate">Заменить подписку</span>
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* PAY-I: компактный профиль одной строкой */}
            <div className="rounded-lg bg-card/60 backdrop-blur-sm border border-border/40 px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="truncate">
                {[formData.email, [formData.firstName, formData.lastName].filter(Boolean).join(" "), formData.phone].filter(Boolean).join(" · ")}
              </span>
            </div>

            {/* F3: installment summary */}
            {isInstallmentOffer && (
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-sm space-y-1">
                <p className="font-medium text-foreground">
                  Рассрочка на {installmentCount} платежа
                </p>
                <p className="text-muted-foreground">
                  Сегодня — первый платёж. Остальные спишутся автоматически с интервалом 30 дней.
                </p>
                <p className="text-xs text-muted-foreground/80 pt-1">
                  После нажатия «Оплатить» вы перейдёте на защищённую страницу bePaid.
                </p>
              </div>
            )}

            {/* PAY-I: subscription-info — 2 короткие строки + штатное упоминание bePaid */}
            {(isSubscription || isTrial) && (
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-sm space-y-1">
                <p className="font-medium text-foreground">
                  {subscriptionMessage?.title || (isClubProduct ? "Подписка на Клуб" : "Ежемесячная подписка")}
                </p>
                <p className="text-muted-foreground">
                  {isClubProduct
                    ? `Сегодня: доступ к Клубу — ${price}.`
                    : subscriptionMessage?.startDate
                      ? `Сегодня: первый месяц обучения — ${price}. Старт ${subscriptionMessage.startDate}.`
                      : `Сегодня: подписка — ${price}.`}
                </p>
                <p className="text-muted-foreground">
                  Далее автосписание раз в месяц. Управление в личном кабинете.
                </p>
                {isSubscription && !isTrial && (
                  <p className="text-xs text-muted-foreground/80 pt-1">
                    bePaid может показать экран «привязка карты для автоплатежей» — это штатный экран оформления подписки.
                  </p>
                )}
              </div>
            )}

            {/* PAY-K: сохранённые карты.
                 - one_time: активный RadioGroup (saved cards + новая карта).
                 - subscription/trial: остаются disabled (PAY-I behavior). */}
            {savedCards.length > 0 && isOneTimeFlow && (
              <div className="rounded-lg border border-border/40 bg-card/40 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Способ оплаты</p>
                <RadioGroup
                  value={selectedMethod}
                  onValueChange={setSelectedMethod}
                  className="space-y-1.5"
                  disabled={isLoading || isTestPaymentLoading}
                >
                  {savedCards.map((c) => (
                    <label
                      key={c.id}
                      htmlFor={`pm-${c.id}`}
                      className="flex items-center gap-2 text-sm cursor-pointer rounded-md px-1.5 py-1 hover:bg-muted/40"
                    >
                      <RadioGroupItem value={c.id} id={`pm-${c.id}`} />
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      <span className="uppercase">{c.brand || "CARD"}</span>
                      <span>•••• {c.last4}</span>
                      {c.is_default && (
                        <span className="text-[10px] text-muted-foreground border border-border/50 rounded px-1 py-0.5">по умолчанию</span>
                      )}
                    </label>
                  ))}
                  <label
                    htmlFor="pm-new_card"
                    className="flex items-center gap-2 text-sm cursor-pointer rounded-md px-1.5 py-1 hover:bg-muted/40"
                  >
                    <RadioGroupItem value="new_card" id="pm-new_card" />
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    <span>Новая карта</span>
                  </label>
                </RadioGroup>
                <p className="text-xs text-muted-foreground">
                  Оплата сохранённой картой выполняется через защищённую сессию bePaid (может потребоваться 3-D Secure).
                </p>
              </div>
            )}

            {/* PAY-I: сохранённые карты при subscription/trial — disabled, info-only */}
            {savedCards.length > 0 && !isOneTimeFlow && (
              <div className="rounded-lg border border-border/40 bg-card/40 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Сохранённые карты</p>
                <div className="space-y-1.5 opacity-60 pointer-events-none select-none" aria-disabled="true">
                  {savedCards.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-sm">
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      <span className="uppercase">{c.brand || "CARD"}</span>
                      <span>•••• {c.last4}</span>
                      {c.is_default && (
                        <span className="text-[10px] text-muted-foreground border border-border/50 rounded px-1 py-0.5">по умолчанию</span>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Сохранённые карты нельзя выбрать для оформления подписки. Вас перенаправит на защищённую страницу bePaid, где нужно будет выбрать или ввести карту для подписки.
                </p>
              </div>
            )}


            {/* MIT vs SBS choice removed — subscriptions always use provider_managed (SBS) */}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (user && session) {
                    onOpenChange(false);
                  } else {
                    handleChangeEmail();
                  }
                }}
                disabled={isLoading || isTestPaymentLoading}
                className="flex-1 min-w-0"
              >
                <span className="truncate">{user && session ? "Отмена" : "Назад"}</span>
              </Button>
              <Button
                onClick={handlePayment}
                disabled={
                  isLoading ||
                  isTestPaymentLoading ||
                  isLoadingCard ||
                  // F1: блокируем оплату только при конфликте по ТОМУ ЖЕ продукту в subscription-flow.
                  (!!conflictData && conflictData.product_id === productId && !!isSubscription && !isTrial)
                }
                className="flex-1 min-w-0"
              >
                {isLoadingCard ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin shrink-0" />
                ) : (
                  <CreditCard className="mr-2 h-4 w-4 shrink-0" />
                )}
                <span className="truncate">{isTrial ? "Активировать триал" : `Оплатить ${price}`}</span>
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground/80 flex items-center gap-1 justify-center">
              <ShieldCheck className="h-3 w-3" />
              Защищённая оплата на стороне bePaid.
            </p>

            {/* Admin test payment button - SECURITY: only super_admin */}
            {isSuperAdmin() && (
              <div className="border-t pt-4 mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestPayment}
                  disabled={isLoading || isTestPaymentLoading}
                  className="w-full border-dashed border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                >
                  {isTestPaymentLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-2 h-4 w-4" />
                  )}
                  Тест: Симулировать оплату (только для админов)
                </Button>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  Создаёт заказ и симулирует успешный webhook от bePaid
                </p>
              </div>
            )}
          </div>
        );

      case "processing": {
        const stageText: Record<typeof processingStage, { primary: string; hint: string }> = {
          preparing: { primary: 'Подготовка платежа…', hint: 'Это займёт несколько секунд' },
          creating_order: { primary: 'Создаём заказ…', hint: 'Подготавливаем платёжную ссылку' },
          charging_card: { primary: 'Списываем карту…', hint: 'Отправляем запрос в банк' },
          redirecting_3ds: { primary: 'Переход на 3D-Secure…', hint: 'Сейчас откроется страница банка для подтверждения' },
        };
        const current = stageText[processingStage];
        return (
          <div className="text-center py-8 px-4">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary mb-4" />
            <p className="text-foreground font-medium">{current.primary}</p>
            <p className="text-sm text-muted-foreground mt-1">{current.hint}</p>
          </div>
        );
      }
    }
  };

  const getStepTitle = () => {
    switch (step) {
      case "email":
        return "Введите email";
      case "login":
        return "Вход в аккаунт";
      case "additional_info":
        return "Данные для покупки";
      case "telegram_prompt":
        return "Привяжите Telegram";
      case "ready":
      case "processing":
        return "Подтверждение оплаты";
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-24px)] sm:max-w-md max-h-[calc(100dvh-24px)] overflow-hidden flex flex-col p-0 bg-background/70 backdrop-blur-2xl border-white/10 shadow-2xl">
          <div className="p-6 pb-3 border-b border-white/10 shrink-0">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                {getStepTitle()}
              </DialogTitle>
              <DialogDescription>
                {productName} — {price}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-6 pt-4">
            {renderStep()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Trial Already Used Modal */}
      <Dialog open={showTrialUsedModal} onOpenChange={setShowTrialUsedModal}>
        <DialogContent className="w-[calc(100vw-24px)] sm:max-w-md max-h-[calc(100dvh-24px)] overflow-y-auto flex flex-col bg-background/70 backdrop-blur-2xl border-white/10 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              Пробный период уже использован
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Вы уже воспользовались бесплатным пробным периодом для этого продукта.
            </p>
            
            <div className="rounded-lg bg-primary/10 border border-primary/20 p-4 space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Продолжите со скидкой!</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Оформите полную подписку, чтобы продолжить пользоваться всеми возможностями {productName}.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowTrialUsedModal(false)}
                className="flex-1"
              >
                Закрыть
              </Button>
              <Button
                onClick={() => {
                  setShowTrialUsedModal(false);
                  // Navigate to product page or stay with current flow (without trial)
                  // The user can still purchase without trial option from the same dialog
                }}
                className="flex-1"
              >
                Купить полный тариф
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Replace subscription confirmation */}
      <Dialog open={showReplaceConfirm} onOpenChange={setShowReplaceConfirm}>
        <DialogContent className="w-[calc(100vw-24px)] sm:max-w-md bg-background/70 backdrop-blur-2xl border-white/10 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Repeat className="h-5 w-5 text-amber-600" />
              Заменить подписку?
            </DialogTitle>
            <DialogDescription>
              Текущая активная подписка будет отменена у провайдера, после чего откроется страница оплаты новой подписки. Доступ по старой подписке прекратится.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setShowReplaceConfirm(false)}
              disabled={replaceStep !== 'idle'}
              className="flex-1"
            >
              Отмена
            </Button>
            <Button
              onClick={handleReplaceSubscription}
              disabled={replaceStep !== 'idle'}
              className="flex-1"
            >
              {replaceStep !== 'idle' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Repeat className="mr-2 h-4 w-4" />
              )}
              {replaceStep === 'cancelling'
                ? 'Отменяем старую…'
                : replaceStep === 'creating'
                ? 'Создаём новую…'
                : 'Подтвердить замену'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
