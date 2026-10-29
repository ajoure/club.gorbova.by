import { describe, expect, it } from "vitest";
import { contactMarkdownToTelegramHtml, prepareContactTelegramMessage, validateContactUrlButtons } from "../../supabase/functions/telegram-admin-chat/messageFormat";

describe("operator Telegram message format", () => {
  it("delivers readable paragraphs and clickable links instead of editor Markdown", () => {
    const result = prepareContactTelegramMessage({
      message_format: "contact_markdown_v1",
      message: "Здравствуйте!\n\n*Доступ открыт*.\n[Открыть урок](https://gorbova.by/library/retail?a=1&b=2)\n\n_Хорошего дня_",
      url_buttons: [{ text: " Материалы ", url: " https://gorbova.by/library/retail " }],
    });
    expect(result.text).toBe('Здравствуйте!\n\n<b>Доступ открыт</b>.\n<a href="https://gorbova.by/library/retail?a=1&amp;b=2">Открыть урок</a>\n\n<i>Хорошего дня</i>');
    expect(result.replyMarkup).toEqual({ inline_keyboard: [[{ text: "Материалы", url: "https://gorbova.by/library/retail" }]] });
    expect(result.text).not.toContain("](");
  });

  it("preserves standalone URLs, empty lines, literal code and balanced URL parentheses", () => {
    expect(contactMarkdownToTelegramHtml("https://gorbova.by/long_module_name\r\n\r\n`x < y & z`"))
      .toBe("https://gorbova.by/long_module_name\n\n<code>x &lt; y &amp; z</code>");
    expect(contactMarkdownToTelegramHtml("[Статья](https://example.com/a_(b))"))
      .toBe('<a href="https://example.com/a_(b)">Статья</a>');
  });

  it("does not execute HTML or turn unsafe Markdown links into HTML links", () => {
    const result = contactMarkdownToTelegramHtml('<script>bad()</script>\n[Жми](javascript:alert(1))');
    expect(result).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(result).not.toContain("<a");
    expect(contactMarkdownToTelegramHtml('[[align:center]]*Важно*')).toBe("<b>Важно</b>");
  });

  it("keeps the legacy HTML contract for clients without the new format marker", () => {
    expect(prepareContactTelegramMessage({ message: "<b>Уже готово</b>" }).text).toBe("<b>Уже готово</b>");
    expect(() => prepareContactTelegramMessage({ message_format: "markdown_v99", message: "test" })).toThrow();
    expect(() => prepareContactTelegramMessage({ message: { bad: true } })).toThrow();
  });

  it.each([
    [{ text: "Кнопка", url: "javascript:alert(1)" }],
    [{ text: "Кнопка", url: "http://gorbova.by/" }],
    [{ text: "Кнопка", url: "https://user:password@gorbova.by/" }],
    [{ text: "Кнопка", url: "https://gorbova.by/\nother" }],
    [{ text: "", url: "https://gorbova.by/" }],
    [{ text: "a".repeat(65), url: "https://gorbova.by/" }],
    [{ text: "Кнопка", url: "https://gorbova.by/", callback_data: "not-allowed" }],
    Array.from({ length: 6 }, () => ({ text: "Урок", url: "https://gorbova.by/" })),
  ])("rejects malformed/unsafe keyboard before sending: %j", (buttons) => {
    expect(() => validateContactUrlButtons(buttons)).toThrow();
  });
});
