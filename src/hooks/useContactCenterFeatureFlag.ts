import { useEffect, useState } from "react";

/**
 * KILL-SWITCH (2026-07-04): Unified inbox отключён после регрессии моно-ленты
 * Telegram (см. docs/audit/2026-07-04-unified-inbox-rollback.md).
 *
 * Прошлый ключ `contact_center_unified_inbox` больше не читается — он чистится
 * при первом монтировании, чтобы у ранее «включённых» операторов не всплыло
 * старое состояние.
 *
 * V2-test bypass: ТОЛЬКО для проверки исправления контракта Telegram
 * (`docs/audit/2026-07-04-unified-inbox-v2-mapping.md`). Флаг включается через
 * `localStorage.setItem("contact_center_unified_inbox_v2_test","1")` и
 * рассчитан на ручное включение инженером на dev-девайсе. По умолчанию
 * возвращает `false` — операторы в production ничего не видят.
 *
 * Setter — no-op: включение через UI-тумблер запрещено до полного proof.
 */
const LEGACY_KEY = "contact_center_unified_inbox";
const V2_TEST_KEY = "contact_center_unified_inbox_v2_test";
const EVENT = "contact_center_unified_inbox_changed";

function clearLegacy(): void {
  try {
    if (localStorage.getItem(LEGACY_KEY) !== null) {
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {}
}

function readV2Test(): boolean {
  try {
    return localStorage.getItem(V2_TEST_KEY) === "1";
  } catch {
    return false;
  }
}

export function useUnifiedInboxFlag(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(readV2Test);

  useEffect(() => {
    clearLegacy();
    setEnabled(readV2Test());
    const onChange = () => setEnabled(readV2Test());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  // UI-setter намеренно no-op: включение только через ручной localStorage
  // V2_TEST_KEY до полного proof unified V2.
  return [enabled, () => {}];
}
