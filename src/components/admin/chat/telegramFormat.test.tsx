import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { contactMarkdownToTelegramHtml } from "../../../../supabase/functions/telegram-admin-chat/messageFormat";
import { getTelegramPlainText, renderTelegramFormattedText } from "./telegramFormat";

afterEach(cleanup);

describe("Telegram outgoing history rendering", () => {
  it("shows escaped plain text exactly as the Telegram HTML recipient sees it", () => {
    const text = 'Проверка: a < b & c > d. <script>текст</script>';
    const html = contactMarkdownToTelegramHtml(text);
    const { container } = render(<p>{renderTelegramFormattedText(html)}</p>);
    expect(container.textContent).toBe(text);
    expect(container.querySelector("script")).toBeNull();
    expect(getTelegramPlainText(html)).toBe(text);
  });
  it("keeps standalone links clickable in history, including a query string", () => {
    const text = "https://gorbova.by/library/course?a=1&b=2";
    render(<p>{renderTelegramFormattedText(contactMarkdownToTelegramHtml(text))}</p>);
    expect(screen.getByRole("link", { name: text })).toHaveAttribute("href", text);
  });
});
