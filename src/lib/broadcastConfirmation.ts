export type BroadcastChannel = "telegram" | "email";

export const FULL_AUDIENCE_PHRASE = "ОТПРАВИТЬ ВСЕМ";

type ConfirmationFilters = {
  include?: unknown[];
  exclude?: unknown[];
  club_ids?: string[];
  bot_ids?: string[];
  education?: unknown;
  webinar_registration?: unknown;
};

/** Bot selection narrows Telegram only; it cannot restrict an email audience. */
export function isFullBroadcastAudience(filters: ConfirmationFilters, channel: BroadcastChannel): boolean {
  return !filters.include?.length
    && !filters.exclude?.length
    && !filters.club_ids?.length
    && !filters.education
    && !filters.webinar_registration
    && (channel === "email" || !filters.bot_ids?.length);
}

export function isFullAudiencePhrase(value: string): boolean {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("ru") === FULL_AUDIENCE_PHRASE;
}
