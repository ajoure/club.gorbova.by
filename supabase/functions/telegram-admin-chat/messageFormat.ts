export type TelegramUrlButton = { text: string; url: string };
export type TelegramUrlKeyboard = { inline_keyboard: TelegramUrlButton[][] };
export const MAX_CONTACT_URL_BUTTONS = 5;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function safeUrl(value: string, httpsOnly = false): string | null {
  if (!value || value.length > 2048 || /\s/.test(value) || hasControlCharacters(value)) return null;
  try {
    const url = new URL(value);
    if (!(httpsOnly ? url.protocol === "https:" : ["https:", "http:"].includes(url.protocol))) return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Only URL buttons: callers cannot inject callback data, payments or Web Apps. */
export function validateContactUrlButtons(value: unknown): TelegramUrlButton[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_CONTACT_URL_BUTTONS) {
    throw new Error("Можно прикрепить не больше пяти кнопок со ссылками");
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).some((key) => !["text", "url"].includes(key))) {
      throw new Error("Допустимы только название кнопки и URL");
    }
    const text = typeof entry.text === "string" ? entry.text.trim() : "";
    const rawUrl = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!text || [...text].length > 64 || hasControlCharacters(text)) {
      throw new Error("Укажите название кнопки от 1 до 64 символов");
    }
    const url = safeUrl(rawUrl, true);
    if (!url) throw new Error("Для каждой кнопки укажите полный HTTPS-адрес без логина и пароля");
    return { text, url };
  });
}

export function contactUrlKeyboard(buttons: TelegramUrlButton[]): TelegramUrlKeyboard | undefined {
  return buttons.length ? { inline_keyboard: buttons.map((button) => [button]) } : undefined;
}

/** The editor's small Markdown dialect, not arbitrary HTML/Markdown execution. */
export function contactMarkdownToTelegramHtml(value: string): string {
  const render = (text: string, depth = 0, autoLink = true): string => {
    if (depth > 8) return escapeHtml(text);
    let out = "";
    let i = 0;
    while (i < text.length) {
      // Keep bare URLs whole: underscores in paths are not italic delimiters.
      const bareUrl = text.slice(i).match(/^https?:\/\/[^\s<>]+/i)?.[0];
      if (bareUrl) {
        const href = autoLink ? safeUrl(bareUrl) : null;
        out += href ? `<a href="${escapeHtml(href)}">${escapeHtml(bareUrl)}</a>` : escapeHtml(bareUrl);
        i += bareUrl.length; continue;
      }
      const char = text[i];
      if (char === "`") {
        const end = text.indexOf("`", i + 1);
        if (end > i + 1) { out += `<code>${escapeHtml(text.slice(i + 1, end))}</code>`; i = end + 1; continue; }
      }
      if (char === "[") {
        const labelEnd = text.indexOf("](", i + 1);
        if (labelEnd > i + 1) {
          let end = labelEnd + 2;
          let balance = 1;
          for (; end < text.length && balance; end++) {
            if (text[end] === "(") balance++;
            if (text[end] === ")") balance--;
          }
          if (!balance) {
            const href = safeUrl(text.slice(labelEnd + 2, end - 1));
            if (href) {
              out += `<a href="${escapeHtml(href)}">${render(text.slice(i + 1, labelEnd), depth + 1, false)}</a>`;
              i = end; continue;
            }
          }
        }
      }
      if ((char === "*" || char === "_") && !/\s/.test(text[i + 1] || " ")) {
        const end = text.indexOf(char, i + 1);
        if (end > i + 1 && !/\s/.test(text[end - 1]) && !text.slice(i + 1, end).includes("\n")) {
          const tag = char === "*" ? "b" : "i";
          out += `<${tag}>${render(text.slice(i + 1, end), depth + 1, autoLink)}</${tag}>`;
          i = end + 1; continue;
        }
      }
      out += escapeHtml(char);
      i++;
    }
    return out;
  };
  return render(value.replace(/\r\n?/g, "\n").replace(/^\[\[align:(?:left|center|right)\]\]/gm, ""));
}

export function prepareContactTelegramMessage(payload: {
  message?: unknown;
  message_format?: unknown;
  url_buttons?: unknown;
}) {
  if (payload.message_format !== undefined && payload.message_format !== "contact_markdown_v1") {
    throw new Error("Неподдерживаемый формат сообщения");
  }
  if (payload.message !== undefined && typeof payload.message !== "string") {
    throw new Error("Текст сообщения должен быть строкой");
  }
  const buttons = validateContactUrlButtons(payload.url_buttons);
  const source = typeof payload.message === "string" ? payload.message : "";
  return {
    text: payload.message_format === "contact_markdown_v1" ? contactMarkdownToTelegramHtml(source) : source,
    replyMarkup: contactUrlKeyboard(buttons),
  };
}
