export type TelegramUrlButton = { text: string; url: string };

const questionnaireUrls = new Set([
  "{{questionnaire.channel_url}}",
  "{{questionnaire.personal_chat_url}}",
]);

/** Optional second button in the existing broadcast template metadata. */
export function parseAdditionalTelegramButton(value: unknown, allowQuestionnaireTokens = false): TelegramUrlButton | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("broadcast_button_invalid");
  const button = value as Record<string, unknown>;
  if (typeof button.text !== "string" || !button.text.trim() || typeof button.url !== "string" || !button.url.trim()) {
    throw new Error("broadcast_button_invalid");
  }
  const url = button.url.trim();
  if (!(allowQuestionnaireTokens && questionnaireUrls.has(url))) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error("broadcast_button_url_invalid"); }
    if (!["https:", "http:", "tg:"].includes(parsed.protocol) || parsed.username || parsed.password || url.includes("{{")) {
      throw new Error("broadcast_button_url_invalid");
    }
  }
  return { text: button.text.trim(), url };
}

export function additionalTelegramButtonFromMetadata(metadata: unknown): TelegramUrlButton | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return parseAdditionalTelegramButton((metadata as Record<string, unknown>).additional_button, true);
}

/** Reuses Telegram's URL keyboard; each button has its own row on mobile. */
export function telegramUrlKeyboard(buttons: TelegramUrlButton[], mapUrl: (url: string) => string = url => url) {
  return buttons.length ? { inline_keyboard: buttons.map(button => {
    const valid = parseAdditionalTelegramButton(button)!;
    return [{ text: valid.text, url: mapUrl(valid.url) }];
  }) } : undefined;
}
