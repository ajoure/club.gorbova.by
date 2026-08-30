import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { DealsFilterPanel } from "@/components/admin/deals/DealsFilterPanel";

const mobile = vi.hoisted(() => ({ value: true }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));
afterEach(cleanup);

function showPanel(isMobile = true) {
  mobile.value = isMobile;
  const onReset = vi.fn();
  const onChange = vi.fn();
  render(<DealsFilterPanel activeCount={1} onReset={onReset}>
    <label htmlFor="manager">Менеджер продажи</label>
    <select id="manager" defaultValue="first" onChange={onChange}>
      <option value="first">Первый менеджер</option>
      <option value="second">Второй менеджер</option>
    </select>
    <button>Последний фильтр</button>
  </DealsFilterPanel>);
  fireEvent.click(screen.getByRole("button", { name: "Фильтры 1" }));
  return { onReset, onChange };
}

describe("Deals responsive filters", () => {
  it("uses an accessible bounded sheet on mobile, not an anchored popover", () => {
    showPanel();
    const panel = screen.getByRole("dialog", { name: "Фильтры сделок" });
    expect(panel).toHaveClass("inset-x-3", "bottom-3", "h-[calc(100dvh-24px)]", "overflow-hidden");
    expect(screen.getByRole("button", { name: "Последний фильтр" }).parentElement)
      .toHaveClass("min-h-0", "flex-1", "overflow-y-auto", "overscroll-contain");
  });

  it("keeps reset and show-results controls outside the scroll area", () => {
    const { onReset } = showPanel();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    expect(onReset).toHaveBeenCalledOnce();
    const done = screen.getByRole("button", { name: "Показать сделки" });
    expect(done.parentElement).toHaveClass("shrink-0");
    fireEvent.click(done);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the mobile sheet with its explicit close button", () => {
    showPanel();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("preserves filter changes and selections while open", () => {
    const { onChange } = showPanel();
    fireEvent.change(screen.getByLabelText("Менеджер продажи"), { target: { value: "second" } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Менеджер продажи")).toHaveValue("second");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("constrains the desktop popover to Radix available height", () => {
    showPanel(false);
    expect(screen.getByRole("dialog", { name: "Фильтры сделок" }))
      .toHaveClass("max-h-[var(--radix-popover-content-available-height)]", "overflow-hidden");
    expect(screen.queryByRole("button", { name: "Показать сделки" })).not.toBeInTheDocument();
  });

  it("wraps toolbar presets/actions and exposes icon action labels", () => {
    const source = readFileSync("src/pages/admin/AdminDeals.tsx", "utf8");
    for (const id of ["deals-toolbar", "deals-presets", "deals-actions"]) {
      expect(source).toMatch(new RegExp(`data-testid="${id}" className="[^"]*flex-wrap`));
    }
    for (const label of ["Экспорт сделок", "Обновить сделки", "Создать сделку вручную", "Очистка архива"]) {
      expect(source).toContain(`aria-label="${label}"`);
    }
  });
});
