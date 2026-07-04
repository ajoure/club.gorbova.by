import { useEffect } from "react";

/**
 * KILL-SWITCH (2026-07-04): Unified inbox отключён после регрессии моно-ленты
 * Telegram. Флаг форсированно возвращает `false`, setter — no-op. Сохранённое
 * ранее значение localStorage чистится один раз при первом монтировании, чтобы
 * при будущем восстановлении фичи не всплыло старое «включено» у операторов.
 *
 * НЕ восстанавливать поведение без proof, что Telegram mono-list открывает
 * историю сообщений (не «Telegram не привязан») и unified контракт
 * ContactTelegramChat починен.
 */
const KEY = "contact_center_unified_inbox";
const EVENT = "contact_center_unified_inbox_changed";

function clearStoredFlag(): void {
  try {
    if (localStorage.getItem(KEY) !== null) {
      localStorage.removeItem(KEY);
    }
  } catch {}
}

export function useUnifiedInboxFlag(): [boolean, (next: boolean) => void] {
  useEffect(() => {
    clearStoredFlag();
    // Разбудим возможных слушателей, чтобы they снялись со старого «true».
    try { window.dispatchEvent(new Event(EVENT)); } catch {}
  }, []);
  return [false, () => {}];
}
