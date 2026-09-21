import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useIncomingMessageAlert } from "./useIncomingMessageAlert";

const mocks = vi.hoisted(() => ({ listeners: [] as Array<{ options: any; callback: any }>, remove: vi.fn(), start: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  channel: () => { const channel = { on: (_: string, options: any, callback: any) => { mocks.listeners.push({ options, callback }); return channel; }, subscribe: () => channel }; return channel; },
  removeChannel: mocks.remove,
} }));
beforeEach(() => {
  mocks.listeners.length = 0; mocks.remove.mockClear(); mocks.start.mockClear();
  vi.stubGlobal("AudioContext", class {
    state = "running"; currentTime = 0; destination = {};
    resume = vi.fn().mockResolvedValue(undefined);
    createOscillator = () => ({ frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: mocks.start, stop: vi.fn() });
    createGain = () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() });
  });
});
afterEach(() => vi.unstubAllGlobals());

it("notifies for canonical inbound Instagram records and incoming Telegram, but not outbound", async () => {
  const { unmount } = renderHook(useIncomingMessageAlert);
  const emit = (table: string, direction: string) => {
    for (const { options, callback } of mocks.listeners) {
      if (options.table === table && options.filter === `direction=eq.${direction}`) callback({ new: { id: "test", direction } });
    }
  };
  await act(async () => emit("instagram_messages", "inbound"));
  expect(mocks.start).toHaveBeenCalledTimes(2);
  await act(async () => emit("instagram_messages", "outbound"));
  expect(mocks.start).toHaveBeenCalledTimes(2);
  await act(async () => emit("telegram_messages", "incoming"));
  expect(mocks.start).toHaveBeenCalledTimes(4);
  unmount();
  expect(mocks.remove).toHaveBeenCalledOnce();
});

it("does not throw on the first editing gesture when audio is unavailable", () => {
  vi.stubGlobal("AudioContext", undefined);
  renderHook(useIncomingMessageAlert);
  expect(() => fireEvent.touchStart(document)).not.toThrow();
});
