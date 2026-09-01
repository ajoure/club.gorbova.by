import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPaymentManagerOptions, usePaymentManagerOptions } from "./usePaymentManagerOptions";

const directory = vi.hoisted(() => ({
  data: [] as Array<{ user_id: string; label: string }>,
  isLoading: false, isFetching: false, isError: false, refetch: vi.fn(),
}));
vi.mock("@/hooks/usePaymentManagerDirectoryOptions", () => ({
  usePaymentManagerDirectoryOptions: () => directory,
}));
afterEach(cleanup);
beforeEach(() => {
  Object.assign(directory, { data: [], isLoading: false, isFetching: false, isError: false });
  directory.refetch.mockClear();
});
const person = (user_id: string, label: string) => ({ user_id, label });
const payment = (responsible_user_id: string | null, responsible_name: string | null) =>
  ({ responsible_user_id, responsible_name });

describe("Payment manager options", () => {
  it("lists directory staff when there are no payments or attributions", () => {
    expect(buildPaymentManagerOptions([person("b", "Борис"), person("a", "Анна")], []))
      .toEqual([{ value: "a", label: "Анна" }, { value: "b", label: "Борис" }]);
    expect(buildPaymentManagerOptions([person("a", "Анна")], [payment(null, null)]))
      .toEqual([{ value: "a", label: "Анна" }]);
  });
  it("deduplicates by user ID, prefers staff labels and retains former staff", () => {
    expect(buildPaymentManagerOptions([person("a", "Новое имя")], [
      payment("a", "Старое имя"), payment("b", "Бывший сотрудник"), payment("b", null),
    ])).toEqual([{ value: "b", label: "Бывший сотрудник" }, { value: "a", label: "Новое имя" }]);
  });
  it("does not merge distinct staff with the same name", () => {
    expect(buildPaymentManagerOptions([person("a", "Анна"), person("b", "Анна")], [])).toHaveLength(2);
  });
  it("does not drop assigned IDs with a missing snapshot or insert sentinel options", () => {
    expect(buildPaymentManagerOptions([], [payment("former", null), payment(null, "Имя"),
      payment("all", "Все"), payment("__unassigned__", "Без")]))
      .toEqual([{ value: "former", label: "Менеджер (имя недоступно)" }]);
  });
  it("retains the selected former manager when the period becomes empty", () => {
    const { result, rerender } = renderHook(({ payments, value }) => usePaymentManagerOptions(payments, value), {
      initialProps: { payments: [payment("former", "Бывший сотрудник")], value: "former" },
    });
    rerender({ payments: [], value: "former" });
    expect(result.current.options).toEqual([{ value: "former", label: "Бывший сотрудник" }]);
    rerender({ payments: [], value: "all" });
    expect(result.current.options).toEqual([]);
  });
  it("keeps selection and available snapshots on directory failure, then recovers", () => {
    directory.data = [person("a", "Анна")];
    const { result, rerender } = renderHook(() => usePaymentManagerOptions([], "a"));
    directory.data = [];
    directory.isError = true;
    rerender();
    expect(result.current.options).toEqual([{ value: "a", label: "Анна" }]);
    expect(result.current.isError).toBe(true);
    result.current.refetch();
    expect(directory.refetch).toHaveBeenCalledOnce();
    directory.data = [person("a", "Анна обновлённая")];
    directory.isError = false;
    rerender();
    expect(result.current.options).toEqual([{ value: "a", label: "Анна обновлённая" }]);
  });
  it("keeps an unknown selected ID distinguishable from unassigned during loading", () => {
    directory.isLoading = true;
    const { result } = renderHook(() => usePaymentManagerOptions([], "selected-id"));
    expect(result.current.options).toEqual([{ value: "selected-id", label: "Выбранный менеджер (имя недоступно)" }]);
    expect(result.current.isLoading).toBe(true);
  });
});
