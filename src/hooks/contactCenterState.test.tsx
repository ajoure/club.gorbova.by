import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTelegramDraft } from "./useTelegramDraft";
import { useRetainedQueryData } from "./useRetainedQueryData";
import { useInboxSelection } from "./useInboxSelection";
import type { UnifiedContactRow } from "./useUnifiedInbox";

beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

describe("contact-center state lifetime", () => {
  it("retains identity during dependent loading/errors, accepts a confirmed removal and isolates operators", () => {
    const { result, rerender } = renderHook(({ data, operator }) => useRetainedQueryData(data, operator), { initialProps: { data: ["identity"] as string[] | undefined, operator: "one" } });
    rerender({ data: undefined, operator: "one" });
    expect(result.current).toEqual(["identity"]);
    rerender({ data: [], operator: "one" });
    expect(result.current).toEqual([]);
    rerender({ data: ["new"], operator: "one" });
    rerender({ data: undefined, operator: "two" });
    expect(result.current).toBeUndefined();
  });

  it("does not close a selected dialog when it leaves the queue, but honors Back and another selection", () => {
    const row = { key: "profile:a", availableSources: ["telegram"], channels: { telegram: { key: "tg:a" } } } as UnifiedContactRow;
    const { result, rerender } = renderHook(({ rows, key, source }) => useInboxSelection(rows, key, source, "operator"), { initialProps: { rows: [row], key: row.key as string | null, source: "tg:a" } });
    rerender({ rows: [], key: row.key, source: "tg:a" });
    expect(result.current).toBe(row);
    rerender({ rows: [], key: "profile:b", source: "tg:b" });
    expect(result.current).toBeNull();
    rerender({ rows: [row], key: row.key, source: "tg:a" });
    rerender({ rows: [row], key: null, source: "tg:a" });
    expect(result.current).toBeNull();
  });

  it("restores text after remount and isolates bot, personal account, contact and operator", () => {
    const initialProps = { operator: "one", contact: "customer", channel: "bot:support" };
    const hook = renderHook(({ operator, contact, channel }) => useTelegramDraft(operator, contact, channel), { initialProps });
    act(() => hook.result.current.setMessage("Неотправленный текст"));
    act(() => hook.result.current.setSelectedFile(new File(["test"], "test.txt")));
    hook.rerender({ ...initialProps, channel: "business:personal" });
    expect(hook.result.current.message).toBe("");
    hook.rerender(initialProps);
    expect(hook.result.current.message).toBe("Неотправленный текст");
    hook.unmount();
    const reopened = renderHook(({ operator, contact, channel }) => useTelegramDraft(operator, contact, channel), { initialProps });
    expect(reopened.result.current.message).toBe("Неотправленный текст");
    expect(reopened.result.current.selectedFile).toBeNull();
    reopened.rerender({ ...initialProps, contact: "another" });
    expect(reopened.result.current.message).toBe("");
    reopened.rerender({ ...initialProps, operator: "two" });
    expect(reopened.result.current.message).toBe("");
    reopened.rerender(initialProps);
    act(() => reopened.result.current.setMessage(""));
    reopened.unmount();
    expect(renderHook(() => useTelegramDraft("one", "customer", "bot:support")).result.current.message).toBe("");
  });

  it("keeps typing and functional emoji insertion working if browser storage is denied", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const { result } = renderHook(() => useTelegramDraft("one", "customer", "bot:support"));
    act(() => { result.current.setMessage("Ответ"); result.current.setMessage(old => old + " 👍"); });
    expect(result.current.message).toBe("Ответ 👍");
  });
});
