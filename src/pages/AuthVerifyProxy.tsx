import { useState, useMemo } from "react";

/**
 * Interstitial для auth-email ссылок (recovery / signup / magiclink / invite / email_change).
 *
 * Письма приходят со ссылкой вида:
 *   https://club.gorbova.by/auth-verify?token=...&type=...&redirect_to=...
 *
 * Host подменяется в supabase/functions/auth-email-hook
 * (см. mem://security/communications/no-supabase-url-leakage), чтобы клиент в
 * письме НИКОГДА не видел *.supabase.co.
 *
 * РАНЬШЕ: страница делала автоматический `window.location.replace` на Supabase
 * verify-endpoint. Это сжигало одноразовый токен, когда почтовые провайдеры
 * (mail.ru, inbox.ru, Outlook Safe Links, корпоративные антивирусы) делали
 * префетч ссылки — пользователь получал «Email link is invalid or has expired».
 *
 * СЕЙЧАС: показываем interstitial-страницу с явной кнопкой «Продолжить».
 * Префетч-боты не нажимают кнопки, JS не выполняют, поэтому токен не сгорает.
 *
 * Никаких useEffect/auto-redirect/meta-refresh/auto-submit здесь быть НЕ должно.
 */
export default function AuthVerifyProxy() {
  const [going, setGoing] = useState(false);

  const targetUrl = useMemo(() => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    if (!supabaseUrl) return "";
    // Полностью сохраняем исходный query string (token, type, redirect_to и т.д.)
    return `${supabaseUrl}/auth/v1/verify${window.location.search}`;
  }, []);

  const handleContinue = () => {
    if (going) return;
    if (!targetUrl) {
      console.error("[AuthVerifyProxy] VITE_SUPABASE_URL is not set");
      return;
    }
    setGoing(true);
    window.location.replace(targetUrl);
  };

  return (
    <>
      {/* Дополнительная защита от сканеров/индексаторов */}
      <meta name="robots" content="noindex,nofollow" />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100dvh",
          padding: "24px",
          background: "linear-gradient(135deg, #F4F6FA 0%, #E8EDF5 100%)",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          color: "#1F2937",
        }}
      >
        <div
          style={{
            maxWidth: 440,
            width: "100%",
            background: "#FFFFFF",
            border: "1px solid #E5E9F0",
            borderRadius: 16,
            padding: 32,
            boxShadow: "0 10px 40px rgba(16, 24, 40, 0.08)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              margin: "0 auto 20px",
              borderRadius: 14,
              background: "#EEF2FF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
            }}
            aria-hidden
          >
            🔐
          </div>

          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>
            Подтверждение действия
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: "#65728A", margin: "0 0 24px" }}>
            Для продолжения нажмите кнопку ниже. Это нужно, чтобы ссылка из письма не была случайно открыта почтовым сервисом.
          </p>

          <button
            type="button"
            onClick={handleContinue}
            disabled={going || !targetUrl}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              padding: "14px 20px",
              borderRadius: 10,
              border: "none",
              background: going ? "#94A3B8" : "#1E40AF",
              color: "#FFFFFF",
              fontSize: 16,
              fontWeight: 600,
              cursor: going || !targetUrl ? "not-allowed" : "pointer",
              transition: "background 0.15s ease",
            }}
          >
            {going ? "Переходим…" : "Продолжить"}
          </button>

          {!targetUrl && (
            <p style={{ marginTop: 16, fontSize: 13, color: "#B91C1C" }}>
              Конфигурация недоступна. Обновите страницу или обратитесь в поддержку.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
