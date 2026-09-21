import { act, fireEvent, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { useInboxRealtimeInvalidation } from "./useInboxRealtimeInvalidation";

const mocks = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: mocks.remove,
} }));

it("catches up all queues in one batch on resume without polling or reloading the page", () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { unmount } = renderHook(useInboxRealtimeInvalidation, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  fireEvent(window, new Event("online"));
  fireEvent(document, new Event("visibilitychange"));
  fireEvent(window, new Event("pageshow"));
  expect(invalidate).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(300));
  for (const key of ["unified-inbox-telegram", "contact-center-unanswered-dialogs", "unified-ig-dialogs", "unified-support-tickets"]) {
    expect(invalidate.mock.calls.filter(([options]) => options?.queryKey?.[0] === key)).toHaveLength(1);
  }
  invalidate.mockClear();
  unmount();
  fireEvent(window, new Event("online"));
  act(() => vi.advanceTimersByTime(1000));
  expect(invalidate).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalledTimes(2);
  visibility.mockRestore();
  vi.useRealTimers();
});
