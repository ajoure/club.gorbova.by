import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createPortal } from "react-dom";
import { PullToRefresh } from "./PullToRefresh";
afterEach(cleanup);
function pull(target: Element) {
  fireEvent.touchStart(target, { touches: [{ clientX: 100, clientY: 0 }] });
  fireEvent.touchMove(target, { touches: [{ clientX: 100, clientY: 800 }] });
  fireEvent.touchEnd(target, { touches: [] });
}
describe("mobile refresh must preserve unfinished work", () => {
  it("does not arm a hard reload after entering text and blurring the field", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = render(<PullToRefresh><input aria-label="Параметры ссылки" /><p>Область формы</p></PullToRefresh>);
      const input = screen.getByRole("textbox"); input.focus();
      fireEvent.change(input, { target: { value: "Черновик ссылки" } }); input.blur();
      pull(screen.getByText("Область формы"));
      expect(input).toHaveValue("Черновик ссылки");
      expect(container.querySelectorAll("svg")).toHaveLength(0); // old implementation shows ready indicator and calls reload
      expect(errors).not.toHaveBeenCalled();
    } finally { errors.mockRestore(); }
  });
  it("does not blur an active editor in pointer capture", () => {
    render(<PullToRefresh><input aria-label="Параметры ссылки" /><p>Область формы</p></PullToRefresh>);
    const input = screen.getByRole("textbox"); input.focus();
    fireEvent.pointerDown(screen.getByText("Область формы")); expect(input).toHaveFocus();
  });
  it("does not intercept touches from a portalled open dialog", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<PullToRefresh onRefresh={refresh}>{createPortal(<div role="dialog" data-state="open"><input aria-label="Черновик" /><p>Содержимое окна</p></div>, document.body)}</PullToRefresh>);
    pull(screen.getByText("Содержимое окна")); expect(refresh).not.toHaveBeenCalled();
  });
  it("keeps explicit state-preserving callbacks working outside editors", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<PullToRefresh onRefresh={refresh}><p>Список</p></PullToRefresh>);
    pull(screen.getByText("Список")); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
  it("does not turn a failed callback into an unhandled page error", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("offline"));
    const { container } = render(<PullToRefresh onRefresh={refresh}><p>Список</p></PullToRefresh>);
    pull(screen.getByText("Список")); await waitFor(() => expect(container.querySelectorAll("svg")).toHaveLength(0));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
