/**
 * inline-auth cross-tab accelerator (same-origin only).
 *
 * SoT — Supabase Auth (refreshSession → getSession → getUser).
 * Этот модуль лишь уменьшает латентность на same-origin: BroadcastChannel + storage-fallback.
 * Между разными поддоменами (club.gorbova.by ↔ zg.gorbova.by) НЕ работает —
 * каждый origin имеет свой BroadcastChannel и свой localStorage.
 */

const CHANNEL_NAME = "inline-auth";
const STORAGE_KEY = "inline-auth:last-confirm";

export type InlineAuthEvent = {
  type: "email_confirmed";
  flowId?: string;
  email?: string;
  ts: number;
};

export type InlineAuthListener = (evt: InlineAuthEvent) => void;

function hasBroadcastChannel(): boolean {
  return typeof window !== "undefined" && typeof (window as any).BroadcastChannel === "function";
}

export function publishInlineAuthEvent(evt: Omit<InlineAuthEvent, "ts">): void {
  const payload: InlineAuthEvent = { ...evt, ts: Date.now() };
  try {
    if (hasBroadcastChannel()) {
      const ch = new BroadcastChannel(CHANNEL_NAME);
      ch.postMessage(payload);
      // Close on next tick to allow delivery.
      setTimeout(() => { try { ch.close(); } catch { /* noop */ } }, 0);
    }
  } catch (e) {
    console.warn("[inlineAuth/broadcast] BroadcastChannel publish failed:", e);
  }
  try {
    // Storage-fallback: setItem с новым значением триггерит 'storage' в других вкладках.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("[inlineAuth/broadcast] localStorage publish failed:", e);
  }
}

/**
 * Подписка на same-origin ускоритель. Возвращает отписку.
 * Не является источником истины — вызывающая сторона всё равно должна перепроверить через Supabase.
 */
export function subscribeInlineAuth(listener: InlineAuthListener): () => void {
  const cleanups: Array<() => void> = [];

  if (hasBroadcastChannel()) {
    try {
      const ch = new BroadcastChannel(CHANNEL_NAME);
      const onMsg = (e: MessageEvent) => {
        const data = e?.data as InlineAuthEvent | undefined;
        if (data && data.type === "email_confirmed") listener(data);
      };
      ch.addEventListener("message", onMsg);
      cleanups.push(() => {
        try { ch.removeEventListener("message", onMsg); } catch { /* noop */ }
        try { ch.close(); } catch { /* noop */ }
      });
    } catch (e) {
      console.warn("[inlineAuth/broadcast] BroadcastChannel subscribe failed:", e);
    }
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const data = JSON.parse(e.newValue) as InlineAuthEvent;
      if (data && data.type === "email_confirmed") listener(data);
    } catch { /* ignore malformed */ }
  };
  try {
    window.addEventListener("storage", onStorage);
    cleanups.push(() => window.removeEventListener("storage", onStorage));
  } catch { /* noop */ }

  return () => {
    for (const c of cleanups) {
      try { c(); } catch { /* noop */ }
    }
  };
}

export const __INLINE_AUTH_INTERNALS__ = { CHANNEL_NAME, STORAGE_KEY };
