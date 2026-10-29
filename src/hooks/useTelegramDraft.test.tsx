import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTelegramDraft } from "./useTelegramDraft";

afterEach(() => { cleanup(); sessionStorage.clear(); });

describe("Telegram drafts with URL buttons", () => {
  it("keeps text and buttons in the exact operator/contact/channel scope", () => {
    const { result, rerender } = renderHook(({ contact, channel, actor }) => useTelegramDraft(actor, contact, channel), {
      initialProps: { actor: "operator-a", contact: "contact-a", channel: "support:bot-a" },
    });
    act(() => {
      result.current.setMessage("Здравствуйте!\n\nОткройте урок.");
      result.current.setUrlButtons([{ text: "Урок", url: "https://gorbova.by/library/course" }]);
    });
    rerender({ actor: "operator-a", contact: "contact-b", channel: "support:bot-a" });
    expect(result.current.message).toBe("");
    expect(result.current.urlButtons).toEqual([]);
    rerender({ actor: "operator-a", contact: "contact-a", channel: "support:bot-b" });
    expect(result.current.urlButtons).toEqual([]);
    rerender({ actor: "operator-b", contact: "contact-a", channel: "support:bot-a" });
    expect(result.current.urlButtons).toEqual([]);
    rerender({ actor: "operator-a", contact: "contact-a", channel: "support:bot-a" });
    expect(result.current.message).toContain("\n\n");
    expect(result.current.urlButtons[0].text).toBe("Урок");
  });

  it("restores a failed/unsubmitted draft on reload and removes it only after clearing", () => {
    const first = renderHook(() => useTelegramDraft("operator", "contact", "bot"));
    act(() => {
      first.result.current.setMessage("Ответ");
      first.result.current.setUrlButtons([{ text: "Урок", url: "https://gorbova.by/library/course" }]);
    });
    first.unmount();
    const second = renderHook(() => useTelegramDraft("operator", "contact", "bot"));
    expect(second.result.current.message).toBe("Ответ");
    expect(second.result.current.urlButtons).toHaveLength(1);
    act(() => { second.result.current.setMessage(""); second.result.current.setUrlButtons([]); });
    second.unmount();
    const third = renderHook(() => useTelegramDraft("operator", "contact", "bot"));
    expect(third.result.current.message).toBe("");
    expect(third.result.current.urlButtons).toEqual([]);
  });
});
