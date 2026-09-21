import { fireEvent, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useChatResumeRefresh } from "./useChatResumeRefresh";

it("refreshes resumed mobile/PWA data, ignores hidden pages, and removes listeners", () => {
  const refresh = vi.fn();
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("hidden");
  const { unmount } = renderHook(() => useChatResumeRefresh(refresh));
  fireEvent(document, new Event("visibilitychange"));
  fireEvent(window, new Event("online"));
  expect(refresh).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  fireEvent(window, new Event("online"));
  fireEvent(window, new Event("pageshow"));
  expect(refresh).toHaveBeenCalledTimes(3);
  unmount();
  fireEvent(window, new Event("online"));
  expect(refresh).toHaveBeenCalledTimes(3);
  visibility.mockRestore();
});
