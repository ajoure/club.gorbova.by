import { useCallback, useEffect, useState } from "react";

/**
 * Feature flag: единая лента «Сообщения» (Telegram + Instagram + Support).
 * Хранится в localStorage. По умолчанию ВЫКЛЮЧЕН — старое поведение моно-лент
 * не меняется, пока оператор явно не включит тумблер в настройках контакт-центра.
 *
 * НЕ управляется миграцией и не хранится в БД — это чисто пользовательский
 * UI-preference на устройство.
 */
const KEY = "contact_center_unified_inbox";
const EVENT = "contact_center_unified_inbox_changed";

function readFlag(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function useUnifiedInboxFlag(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(readFlag);

  useEffect(() => {
    const onChange = () => setEnabled(readFlag());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const set = useCallback((next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [enabled, set];
}
