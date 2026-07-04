import { useEffect, useMemo, useState } from "react";
import { useHasRole } from "./useHasRole";

/**
 * CONTROLLED ROLLOUT (2026-07-04, V2-ROLLOUT):
 *
 * Unified inbox V2 включается только для superadmin. Обычные операторы видят
 * старый интерфейс. Kill-switch — локальный (per browser/session) аварийный
 * выключатель для быстрого «снять фичу с себя»; глобальное отключение —
 * только код-роллбэк (см. return в самом низу хука).
 *
 * Матрица включения:
 *   kill=1 (localStorage)               → false, source='kill'
 *   иначе, superadmin                   → true,  source='superadmin'
 *   иначе, qa-override && (admin|DEV)   → true,  source='qa-override'
 *   иначе                               → false, source='default-off'
 *
 * QA-override НЕ работает для обычного оператора в production —
 * это отсекает ситуацию «оператор открыл консоль и включил себе фичу».
 */
const LEGACY_KEY = "contact_center_unified_inbox";
const V2_TEST_KEY = "contact_center_unified_inbox_v2_test";
const KILL_KEY = "contact_center_unified_inbox_kill";
const EVENT = "contact_center_unified_inbox_changed";

export type UnifiedInboxFlagSource =
  | "kill"
  | "superadmin"
  | "qa-override"
  | "default-off";

export interface UnifiedInboxRolloutStatus {
  enabled: boolean;
  source: UnifiedInboxFlagSource;
  isSuperadmin: boolean;
  isAdmin: boolean;
  killActive: boolean;
  qaOverrideActive: boolean;
  /** true, если пользователь имеет право видеть кнопку kill-switch в Settings. */
  canManageKill: boolean;
  setKill: (next: boolean) => void;
}

function readLS(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function clearLegacy(): void {
  try {
    if (localStorage.getItem(LEGACY_KEY) !== null) {
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {}
}

function useLocalFlags() {
  const [killActive, setKillActive] = useState<boolean>(() => readLS(KILL_KEY));
  const [qaOverrideActive, setQaOverride] = useState<boolean>(() => readLS(V2_TEST_KEY));

  useEffect(() => {
    clearLegacy();
    const sync = () => {
      setKillActive(readLS(KILL_KEY));
      setQaOverride(readLS(V2_TEST_KEY));
    };
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return { killActive, qaOverrideActive };
}

function emitChange() {
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {}
}

export function useUnifiedInboxRolloutStatus(): UnifiedInboxRolloutStatus {
  const { hasRole: isSuperadmin } = useHasRole("superadmin");
  const { hasRole: isAdmin } = useHasRole("admin");
  const { killActive, qaOverrideActive } = useLocalFlags();

  const isDev = import.meta.env.DEV;
  const qaAllowed = qaOverrideActive && (isSuperadmin || isAdmin || isDev);

  const source: UnifiedInboxFlagSource = killActive
    ? "kill"
    : isSuperadmin
      ? "superadmin"
      : qaAllowed
        ? "qa-override"
        : "default-off";

  const enabled = source === "superadmin" || source === "qa-override";

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const setKill = useMemo(
    () => (next: boolean) => {
      try {
        if (next) {
          localStorage.setItem(KILL_KEY, "1");
        } else {
          localStorage.removeItem(KILL_KEY);
        }
      } catch {}
      emitChange();
    },
    [],
  );

  return {
    enabled,
    source,
    isSuperadmin,
    isAdmin,
    killActive,
    qaOverrideActive: qaAllowed,
    canManageKill: isSuperadmin || isAdmin,
    setKill,
  };
}

/**
 * Совместимость с существующими вызовами. Setter — no-op:
 * включение операторам через UI-тумблер запрещено, для управления
 * kill-switch используйте `useUnifiedInboxRolloutStatus().setKill`.
 */
export function useUnifiedInboxFlag(): [boolean, (next: boolean) => void] {
  const { enabled } = useUnifiedInboxRolloutStatus();
  return [enabled, () => {}];
}
