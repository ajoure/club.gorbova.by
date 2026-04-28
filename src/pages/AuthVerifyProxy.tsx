import { useEffect } from "react";

/**
 * Прозрачный прокси для auth-email ссылок.
 *
 * Письма (recovery / signup / magiclink / invite / email_change) приходят со ссылкой
 * вида: https://gorbova.by/auth/v1/verify?token=...&type=...&redirect_to=...
 *
 * Хост подменяется в supabase/functions/auth-email-hook (см.
 * mem://security/communications/no-supabase-url-leakage), чтобы клиент в письме
 * НИКОГДА не видел *.supabase.co. Здесь делаем 1-в-1 редирект на реальный
 * Supabase verify-endpoint, сохраняя весь query string. Supabase сам обработает
 * verify и редиректнёт на redirect_to (gorbova.by/...).
 */
export default function AuthVerifyProxy() {
  useEffect(() => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    if (!supabaseUrl) {
      console.error("[AuthVerifyProxy] VITE_SUPABASE_URL is not set");
      return;
    }
    const target = `${supabaseUrl}/auth/v1/verify${window.location.search}`;
    window.location.replace(target);
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", fontFamily: "system-ui, sans-serif", color: "#65728A" }}>
      Перенаправляем…
    </div>
  );
}
