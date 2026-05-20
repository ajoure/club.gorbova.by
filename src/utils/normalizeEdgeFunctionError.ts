/**
 * Normalizes Edge Function errors into user-friendly Russian messages.
 *
 * supabase-js v2 throws `FunctionsHttpError` for non-2xx responses with a
 * generic "Edge Function returned a non-2xx status code" message. The actual
 * server payload lives on `error.context` (a `Response`-like object) — we try
 * to read its body to extract a meaningful reason.
 *
 * @param error    The thrown error (from supabase.functions.invoke or fetch)
 * @param fallback Optional already-parsed body (when the caller has it)
 */
export function normalizeEdgeFunctionError(
  error: unknown,
  fallback?: unknown,
): string {
  // 1) Try parsed fallback first.
  const fromFallback = extractMeaningful(fallback);
  if (fromFallback) return mapKnown(fromFallback) ?? fromFallback;

  // 2) Try error.context body if present (sync — only if already parsed).
  const ctxBody = (error as any)?.context?.body;
  const fromCtx = extractMeaningful(ctxBody);
  if (fromCtx) return mapKnown(fromCtx) ?? fromCtx;

  // 3) Try error.context.error / .details / .message
  const ctx = (error as any)?.context;
  if (ctx && typeof ctx === "object") {
    const fromCtxFields = extractMeaningful(ctx);
    if (fromCtxFields) return mapKnown(fromCtxFields) ?? fromCtxFields;
  }

  // 4) Try error.details / error.error / error.error_description
  const errAsAny = error as any;
  for (const key of ["details", "error", "error_description", "reason"]) {
    const v = errAsAny?.[key];
    if (typeof v === "string" && v.trim()) {
      const mapped = mapKnown(v);
      if (mapped) return mapped;
    }
  }

  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof (error as any)?.message === "string"
          ? (error as any).message
          : "";
  const message = rawMessage || String(error);
  const mapped = mapKnown(message);
  if (mapped) return mapped;

  // Generic supabase-js wrappers — only show fallback if we truly have nothing.
  if (
    message.includes("Edge Function returned a non-2xx status code") ||
    message.includes("FunctionsHttpError") ||
    message.includes("Failed to fetch")
  ) {
    return "Функция временно недоступна. Попробуйте через 10 секунд.";
  }
  if (message.includes("FunctionsRelayError") || message.includes("timeout")) {
    return "Превышено время ожидания. Попробуйте ещё раз.";
  }

  return message;
}

/** Extract a human-readable string from a body/object. */
function extractMeaningful(body: unknown): string | null {
  if (!body) return null;
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return null;
    // Try parse JSON string
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return extractMeaningful(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (typeof body === "object") {
    const o = body as Record<string, any>;
    for (const key of [
      "error",
      "message",
      "error_description",
      "details",
      "reason",
      "code",
    ]) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

/** Map known backend codes/messages to friendly Russian text. */
function mapKnown(raw: string): string | null {
  const s = raw.toLowerCase();

  // Gotenberg / PDF conversion
  if (s.includes('gotenberg_not_configured')) return 'Gotenberg не настроен';
  if (s.includes('gotenberg_disabled')) return 'Конвертация PDF отключена';
  if (s.includes('gotenberg_auth_failed')) return 'Ошибка авторизации Gotenberg';
  if (s.includes('gotenberg_timeout')) return 'Превышено время ожидания конвертации';
  if (s.includes('gotenberg_url_not_allowed') || s.includes('gotenberg_ssrf_blocked')) {
    return 'URL запрещён настройками безопасности';
  }
  if (s.includes('gotenberg_pdf_too_small') || s.includes('gotenberg_not_pdf')) {
    return 'Gotenberg вернул некорректный PDF';
  }
  if (s.includes('gotenberg_unreachable') || s.includes('gotenberg_http_error')) {
    return 'Gotenberg недоступен. Попробуйте позже.';
  }
  if (s.includes('pdf_conversion_failed')) {
    return 'Не удалось сконвертировать документ в PDF';
  }

  if (s.includes('resume_blocked_no_payment_method')) {
    return 'Нужно заново привязать карту или оформить новую подписку.';
  }
  if (s.includes('resume_blocked_provider_dead')) {
    return 'Эту подписку нельзя возобновить — оформите новую.';
  }
  if (s.includes('resume_blocked_not_needed')) {
    return 'Подписка уже активна.';
  }
  if (s.includes('resume_blocked_provider_check_failed')) {
    return 'Не удалось проверить статус подписки у провайдера. Попробуйте позже или оформите новую подписку.';
  }

  if (
    s.includes("already has active provider subscription") ||
    s.includes("duplicate_subscription") ||
    s.includes("already_has_active_subscription")
  ) {
    return "У вас уже есть активная подписка на этот продукт. Проверьте её статус в личном кабинете или отмените, чтобы создать новую.";
  }
  if (s.includes("missing_explicit_choice")) {
    return "Действие требует подтверждения. Обновите страницу и попробуйте снова.";
  }
  if (s.includes("bepaid_creds_missing") || s.includes("bepaid creds")) {
    return "Платёжная система временно недоступна. Попробуйте через минуту.";
  }
  if (s.includes("identity_required") || s.includes("not authenticated")) {
    return "Не удалось подтвердить аккаунт. Войдите или укажите email.";
  }
  if (s.includes("could not determine subscription amount")) {
    return "Не удалось определить сумму подписки. Свяжитесь с поддержкой.";
  }
  if (s.includes("access denied") || s.includes("forbidden")) {
    return "Действие не разрешено для вашего аккаунта.";
  }
  if (
    s.includes("disabled") ||
    s.includes("410") ||
    s.includes("gone") ||
    s.includes("mit_disabled")
  ) {
    return "Эта операция временно отключена.";
  }
  if (s.includes("virtual_card_not_allowed")) {
    return "Виртуальные карты не принимаются. Используйте физическую банковскую карту.";
  }
  if (s.includes("rate limit") || s.includes("too many requests")) {
    return "Слишком много попыток. Подождите минуту и попробуйте снова.";
  }
  if (s.includes("invalid_token") || s.includes("token expired")) {
    return "Сессия истекла. Обновите страницу и попробуйте снова.";
  }
  if (s.includes("payment_failed") || s.includes("card declined")) {
    return "Платёж отклонён банком. Попробуйте другую карту или свяжитесь с банком.";
  }
  if (
    s.includes("subscription_precreate_failed") ||
    s.includes("failed to pre-create subscription") ||
    s.includes("bepaid subscription creation failed") ||
    s.includes("bepaid checkout creation failed") ||
    s.includes("failed to create order")
  ) {
    return "Не удалось подготовить платёж. Мы зафиксировали ошибку — попробуйте ещё раз через минуту или напишите в поддержку.";
  }

  return null;
}
