/**
 * Тесты useAwaitInlineAuthReady — единый waiter подтверждения email.
 *
 * Сценарии (соответствуют DoD P2):
 *  1. polling-only: ускорители не сработали, ready наступает через polling;
 *  2. ускоритель (BroadcastChannel): ready < 1с после события;
 *  3. expired: 5 мин без подтверждения → state=expired, onExpired вызван;
 *  4. resend: использует emailRedirectTo=/auth-verify;
 *  5. гонки: тройное событие → onReady вызван ровно 1 раз;
 *  6. unmount: все таймеры очищены;
 *  7. отсутствует session/refresh_token → waiter остаётся waiting_confirm, не падает.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Мок supabase-клиента ДО импорта хука
vi.mock("@/integrations/supabase/client", () => {
  const listeners: Array<(evt: string, session: any) => void> = [];
  return {
    supabase: {
      auth: {
        _listeners: listeners,
        getSession: vi.fn(),
        refreshSession: vi.fn(),
        getUser: vi.fn(),
        resend: vi.fn(),
        onAuthStateChange: vi.fn((cb: any) => {
          listeners.push(cb);
          return { data: { subscription: { unsubscribe: () => {
            const i = listeners.indexOf(cb);
            if (i >= 0) listeners.splice(i, 1);
          } } } };
        }),
      },
      functions: { invoke: vi.fn().mockResolvedValue({ data: {}, error: null }) },
    },
  };
});

import { useAwaitInlineAuthReady, buildAuthVerifyRedirect, WAIT_TIMEOUT_MS, POLL_INTERVAL_MS } from "../useAwaitInlineAuthReady";
import { publishInlineAuthEvent } from "@/lib/inlineAuth/broadcast";
import { supabase } from "@/integrations/supabase/client";

const authMock = supabase.auth as any;

function mockPending() {
  authMock.getSession.mockResolvedValue({ data: { session: null }, error: null });
  authMock.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: "no refresh" } });
  authMock.getUser.mockResolvedValue({ data: { user: null }, error: { message: "no user" } });
}

function mockReady(email = "u@e.com") {
  const session = { access_token: "at", refresh_token: "rt", user: { id: "u1", email } };
  authMock.getSession.mockResolvedValue({ data: { session }, error: null });
  authMock.refreshSession.mockResolvedValue({ data: { session }, error: null });
  authMock.getUser.mockResolvedValue({
    data: { user: { id: "u1", email, email_confirmed_at: new Date().toISOString() } },
    error: null,
  });
}

describe("useAwaitInlineAuthReady", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    authMock._listeners.length = 0;
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polling-only: ready наступает через polling без ускорителей", async () => {
    mockPending();
    const onReady = vi.fn();
    const { result } = renderHook(() =>
      useAwaitInlineAuthReady({ email: "u@e.com", flowId: "f1", enabled: true, onReady }),
    );

    // немедленная checkNow → pending
    await act(async () => { await Promise.resolve(); });
    expect(result.current.state).toBe("waiting_confirm");
    expect(onReady).not.toHaveBeenCalled();

    // Переключаем моки на ready и продвигаем polling
    mockReady();
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS + 50);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(result.current.state).toBe("ready");
  });

  it("ускоритель (BroadcastChannel/storage): ready наступает почти сразу", async () => {
    mockPending();
    const onReady = vi.fn();
    renderHook(() =>
      useAwaitInlineAuthReady({ email: "u@e.com", flowId: "f1", enabled: true, onReady }),
    );
    await act(async () => { await Promise.resolve(); });

    mockReady();
    await act(async () => {
      publishInlineAuthEvent({ type: "email_confirmed", flowId: "f1", email: "u@e.com" });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });

  it("expired: onExpired вызван по таймауту 5 мин", async () => {
    mockPending();
    const onReady = vi.fn();
    const onExpired = vi.fn();
    const { result } = renderHook(() =>
      useAwaitInlineAuthReady({ email: "u@e.com", flowId: "f1", enabled: true, onReady, onExpired }),
    );
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      vi.advanceTimersByTime(WAIT_TIMEOUT_MS + 100);
      await Promise.resolve();
    });

    expect(result.current.state).toBe("expired");
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("resend использует emailRedirectTo=/auth-verify", async () => {
    mockPending();
    authMock.resend.mockResolvedValue({ error: null });
    const { result } = renderHook(() =>
      useAwaitInlineAuthReady({ email: "U@E.com", flowId: "f1", enabled: true, onReady: vi.fn() }),
    );
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.resend(); });

    expect(authMock.resend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "signup",
        email: "u@e.com",
        options: expect.objectContaining({ emailRedirectTo: buildAuthVerifyRedirect() }),
      }),
    );
    expect(buildAuthVerifyRedirect()).toMatch(/\/auth-verify$/);
  });

  it("гонки: тройное событие приводит к одному onReady", async () => {
    mockReady();
    const onReady = vi.fn();
    renderHook(() =>
      useAwaitInlineAuthReady({ email: "u@e.com", flowId: "f1", enabled: true, onReady }),
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Дополнительно бахнем событие и продвинем polling
    await act(async () => {
      publishInlineAuthEvent({ type: "email_confirmed", flowId: "f1" });
      // Триггерим onAuthStateChange listeners
      for (const l of authMock._listeners) l("USER_UPDATED", {});
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 2);
      await Promise.resolve(); await Promise.resolve();
    });

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });

  it("unmount очищает таймеры (нет вызовов после unmount)", async () => {
    mockPending();
    const onReady = vi.fn();
    const { unmount } = renderHook(() =>
      useAwaitInlineAuthReady({ email: "u@e.com", flowId: "f1", enabled: true, onReady }),
    );
    await act(async () => { await Promise.resolve(); });

    const callsBefore = authMock.getSession.mock.calls.length;
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(WAIT_TIMEOUT_MS + POLL_INTERVAL_MS * 3);
      await Promise.resolve();
    });

    // После unmount новых вызовов быть не должно (или крайне мало из in-flight)
    const callsAfter = authMock.getSession.mock.calls.length;
    expect(callsAfter - callsBefore).toBeLessThanOrEqual(1);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("нет refresh_token: waiter остаётся waiting_confirm, не бросает", async () => {
    mockPending();
    authMock.refreshSession.mockRejectedValue(new Error("Auth session missing"));
    const onReady = vi.fn();
    const { result } = renderHook(() =>
      useAwaitInlineAuthReady({ email: "u@e.com", flowId: "f1", enabled: true, onReady }),
    );
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS + 50);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(result.current.state).toBe("waiting_confirm");
    expect(onReady).not.toHaveBeenCalled();
  });
});
