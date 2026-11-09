import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ token: "test-token-before-refresh" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: { access_token: fixture.token }, user: { id: "synthetic-user" }, role: "user" }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", async original => ({ ...await original<typeof import("@tanstack/react-query")>(), useQuery: () => ({ data: { event_type: "live_stream" }, isLoading: false }) }));
vi.mock("@/hooks/useRoomEntryPrefs", () => ({ useRoomEntryPrefs: () => ({ prefs: null, isLoading: false, syncSessionMirror: vi.fn() }) }));
vi.mock("@/hooks/useLiveContactSheet", () => ({ useLiveContactSheet: () => ({ selectedContact: null, contactSheetOpen: false, setContactSheetOpen: vi.fn(), openContactSheet: vi.fn() }) }));
vi.mock("@/hooks/useUnansweredQuestionsCount", () => ({ useUnansweredQuestionsCount: () => 0 }));
vi.mock("@/hooks/useScreenWakeLock", () => ({ useScreenWakeLock: () => {} }));
vi.mock("@/hooks/useVisualViewportInset", () => ({ useVisualViewportInset: () => {} }));
vi.mock("@/components/admin/ContactDetailSheet", () => ({ ContactDetailSheet: () => null }));
vi.mock("@/components/live/LiveEventComments", () => ({ LiveEventComments: () => null }));
vi.mock("@/components/live/LiveEventQuestions", () => ({ LiveEventQuestions: () => null }));
vi.mock("@/components/live/LiveEventRoomBlocks", () => ({ LiveEventRoomBlocks: () => null }));
vi.mock("@/components/live/RoomParticipantsList", () => ({ RoomParticipantsList: () => null }));
vi.mock("@/components/live/RoomLifecycleActions", () => ({ RoomLifecycleActions: () => null }));
vi.mock("@/components/live/RoomEntryDialog", () => ({ RoomEntryDialog: () => null }));
vi.mock("@/components/live/RoomPreStartScreen", () => ({ RoomPreStartScreen: () => null }));
vi.mock("@/components/live/AutowebSessionSelector", () => ({ AutowebSessionSelector: () => null }));
vi.mock("@/components/live/AutowebRoomRuntime", () => ({ AutowebRoomRuntime: () => null }));
vi.mock("@/components/live/LiveEventProductCta", () => ({ LiveEventProductCta: () => null, useHasActiveCtaBindings: () => false }));
import LiveEvent from "./LiveEvent";

function room() {
  return <MemoryRouter initialEntries={["/live/synthetic-room"]}><Routes><Route path="/live/:slug" element={<LiveEvent />} /></Routes></MemoryRouter>;
}
const ended = () => ({ status: 410, json: async () => ({ status: "replay_disabled", title: "Old event" }) });
beforeEach(() => { fixture.token = "test-token-before-refresh"; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("live room recovery in the actual page", () => {
  it("renders the unavailable replay and lets the member find current events", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ended()));
    render(room());
    expect(await screen.findByRole("heading", { name: "Old event" })).toBeInTheDocument();
    expect(screen.getByText("Эфир завершён. Запись пока недоступна.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Перейти к списку эфиров" })).toHaveAttribute("href", "/live");
    expect(screen.queryByRole("heading", { name: "Ошибка" })).not.toBeInTheDocument();
  });
  it("recognizes a gateway 401 without parsing JSON, then recovers when the SDK refreshes the token", async () => {
    const json = vi.fn();
    const fetch = vi.fn().mockResolvedValueOnce({ status: 401, json }).mockResolvedValue(ended());
    vi.stubGlobal("fetch", fetch);
    const view = render(room());
    expect(await screen.findByRole("heading", { name: "Нужно обновить подключение" })).toBeInTheDocument();
    expect(json).not.toHaveBeenCalled();
    fixture.token = "test-token-after-refresh";
    view.rerender(room());
    await screen.findByText("Эфир завершён. Запись пока недоступна.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer test-token-after-refresh");
  });
  it("recovers from a cold-start network failure without a page reload", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(ended());
    vi.stubGlobal("fetch", fetch);
    render(room());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: "Ошибка" })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText("Эфир завершён. Запись пока недоступна.")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("cancels pending retries when leaving the room", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    const view = render(room());
    await act(async () => { await Promise.resolve(); });
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
