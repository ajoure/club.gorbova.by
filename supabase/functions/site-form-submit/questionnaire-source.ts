/** Shared browser/server allowlist. Attribution is telemetry, never identity or access. */
type QuestionnaireSourceConfig = { label: string; source: string; medium?: string; content?: string };
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
  platforma: { label: "Продающий вебинар", source: "veb", medium: "141026", content: "anketa_veb" },
} as const satisfies Record<string, QuestionnaireSourceConfig>;

export type QuestionnaireSource = keyof typeof QUESTIONNAIRE_SOURCES;

export function parseQuestionnaireSource(value: unknown): QuestionnaireSource | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(QUESTIONNAIRE_SOURCES, value)
    ? value as QuestionnaireSource
    : null;
}

export function questionnaireSourceMetadata(value: unknown) {
  const code = parseQuestionnaireSource(value);
  if (!code) return null;
  const entry: QuestionnaireSourceConfig = QUESTIONNAIRE_SOURCES[code];
  return {
    source_code: code,
    source_label: entry.label,
    utm_source: entry.source,
    utm_medium: entry.medium || code,
    utm_campaign: "cb21_preregistration",
    ...(entry.content ? { utm_content: entry.content } : {}),
  };
}

export function questionnaireSourceLinks(pageUrl: string) {
  const page = new URL(pageUrl);
  if (page.protocol !== "https:") throw new Error("questionnaire_https_required");
  return Object.entries(QUESTIONNAIRE_SOURCES).map(([code, entry]) => {
    const metadata = questionnaireSourceMetadata(code)!;
    const url = new URL(page);
    url.searchParams.set("src", code);
    url.searchParams.set("utm_source", metadata.utm_source);
    url.searchParams.set("utm_medium", metadata.utm_medium);
    url.searchParams.set("utm_campaign", metadata.utm_campaign);
    if (metadata.utm_content) url.searchParams.set("utm_content", metadata.utm_content);
    return { label: entry.label, url: url.toString() };
  });
}
