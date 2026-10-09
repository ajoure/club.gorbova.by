/** Shared browser/server allowlist. Attribution is telemetry, never identity or access. */
export const QUESTIONNAIRE_SOURCES = {
  main_channel: { label: "Основной канал", source: "telegram" },
  questionnaire_channel: { label: "Канал анкеты", source: "telegram" },
  extra_channel: { label: "Дополнительный канал", source: "telegram" },
  email: { label: "Почта", source: "email" },
  bot: { label: "Бот", source: "telegram" },
  stories: { label: "Сторис", source: "instagram" },
  bio: { label: "Шапка профиля", source: "instagram" },
  club: { label: "Клуб", source: "club" },
  reels: { label: "Рилс", source: "instagram" },
  direct: { label: "Директ", source: "instagram" },
} as const;

export type QuestionnaireSource = keyof typeof QUESTIONNAIRE_SOURCES;

export function parseQuestionnaireSource(value: unknown): QuestionnaireSource | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(QUESTIONNAIRE_SOURCES, value)
    ? value as QuestionnaireSource
    : null;
}

export function questionnaireSourceMetadata(value: unknown) {
  const code = parseQuestionnaireSource(value);
  if (!code) return null;
  return {
    source_code: code,
    source_label: QUESTIONNAIRE_SOURCES[code].label,
    utm_source: QUESTIONNAIRE_SOURCES[code].source,
    utm_medium: code,
    utm_campaign: "cb21_preregistration",
  };
}

export function questionnaireSourceLinks(pageUrl: string) {
  const page = new URL(pageUrl);
  if (page.protocol !== "https:") throw new Error("questionnaire_https_required");
  return Object.entries(QUESTIONNAIRE_SOURCES).map(([code, entry]) => {
    const url = new URL(page);
    url.searchParams.set("src", code);
    url.searchParams.set("utm_source", entry.source);
    url.searchParams.set("utm_medium", code);
    url.searchParams.set("utm_campaign", "cb21_preregistration");
    return { label: entry.label, url: url.toString() };
  });
}
