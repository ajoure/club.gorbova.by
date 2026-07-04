import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-OPTIN (2026-07-04):
 *
 * Personal opt-in для единой ленты «Сообщения». Ранее фича включалась
 * автоматически для роли superadmin (controlled rollout V2) — сейчас доступна
 * ЛЮБОМУ сотруднику с доступом в контакт-центр через переключатель в
 * «Настройки → Единая лента». Дефолт для всех — OFF. Full production rollout
 * (принудительно для всех) — по-прежнему deferred.
 *
 * Матрица включения:
 *   optin[user_id]=1 → enabled=true,  source='user-optin'
 *   иначе            → enabled=false, source='default-off'
 *
 * ХРАНИЛИЩЕ (per-user, per-browser):
 *   localStorage.contact_center_unified_inbox_optin =
 *     JSON.stringify({ [user_id]: true })
 *
 * Namespace по user_id критичен: без него сотрудник, включивший opt-in, и
 * следующий залогинившийся в том же браузере — увидели бы одну и ту же ленту.
 *
 * MIGRATION (one-shot):
 *   contact_center_unified_inbox_v2_test=1 → optin[current user]=true
 *   contact_center_unified_inbox_kill      → просто удаляется (kill убран)
 *   contact_center_unified_inbox (legacy)  → просто удаляется
 *
 * ROLLBACK PATH:
 *   Если что-то пойдёт не так — код-роллбэк этого файла возвращает V2 в
 *   controlled-rollout режим (superadmin-only). Никакие kill-switch в UI
 *   больше не поддерживаются.
 */
const LEGACY_KEY = "contact_center_unified_inbox";
const LEGACY_KILL_KEY = "contact_center_unified_inbox_kill";
const LEGACY_V2_TEST_KEY = "contact_center_unified_inbox_v2_test";
const OPTIN_KEY = "contact_center_unified_inbox_optin";
const EVENT = "contact_center_unified_inbox_changed";

export type UnifiedInboxFlagSource = "user-optin" | "default-off";

export interface UnifiedInboxRolloutStatus {
  enabled: boolean;
  source: UnifiedInboxFlagSource;
  /** true, пока идёт первичная загрузка сессии (user?.id ещё не определён). */
  isLoading: boolean;
  /** Персональный флаг текущего пользователя (opt-in). */
  optin: boolean;
  /** Установить opt-in для текущего пользователя. */
  setOptin: (next: boolean) => void;
}

function readOptinMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPTIN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, boolean>;
    return {};
  } catch {
    return {};
  }
}

function writeOptinMap(map: Record<string, boolean>) {
  try {
    localStorage.setItem(OPTIN_KEY, JSON.stringify(map));
  } catch {}
}

function migrateLegacy(userId: string | undefined | null) {
  try {
    // Удаляем kill / legacy — они больше не поддерживаются.
    if (localStorage.getItem(LEGACY_KILL_KEY) !== null) {
      localStorage.removeItem(LEGACY_KILL_KEY);
    }
    if (localStorage.getItem(LEGACY_KEY) !== null) {
      localStorage.removeItem(LEGACY_KEY);
    }
    // Один раз мигрируем `_v2_test=1` в opt-in текущего юзера, затем удаляем.
    const legacyV2 = localStorage.getItem(LEGACY_V2_TEST_KEY);
    if (legacyV2 === "1" && userId) {
      const map = readOptinMap();
      if (!map[userId]) {
        map[userId] = true;
        writeOptinMap(map);
      }
      localStorage.removeItem(LEGACY_V2_TEST_KEY);
    } else if (legacyV2 !== null && !userId) {
      // Юзер не определён — миграцию отложим до следующего монтирования.
    } else if (legacyV2 !== null) {
      localStorage.removeItem(LEGACY_V2_TEST_KEY);
    }
  } catch {}
}

function emitChange() {
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {}
}

export function useUnifiedInboxRolloutStatus(): UnifiedInboxRolloutStatus {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [optinMap, setOptinMap] = useState<Record<string, boolean>>(() => readOptinMap());

  useEffect(() => {
    migrateLegacy(userId);
    setOptinMap(readOptinMap());
    const sync = () => setOptinMap(readOptinMap());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [userId]);

  const optin = !!(userId && optinMap[userId]);
  const isLoading = !userId;

  const source: UnifiedInboxFlagSource = optin ? "user-optin" : "default-off";
  const enabled = !isLoading && optin;

  const setOptin = useMemo(
    () => (next: boolean) => {
      if (!userId) return;
      const map = readOptinMap();
      if (next) {
        map[userId] = true;
      } else {
        delete map[userId];
      }
      writeOptinMap(map);
      setOptinMap(map);
      emitChange();
    },
    [userId],
  );

  return { enabled, source, isLoading, optin, setOptin };
}

/**
 * Совместимость с существующими вызовами. Setter теперь — реальный
 * пер-пользовательский opt-in.
 */
export function useUnifiedInboxFlag(): [boolean, (next: boolean) => void] {
  const { enabled, setOptin } = useUnifiedInboxRolloutStatus();
  return [enabled, setOptin];
}
