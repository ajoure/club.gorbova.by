import { questionnairePersonalChatUrl } from "./questionnairePersonalChat";

/** Layout is CMS content; destination links stay in the existing bonus settings. */
export function webinarThanksDesign(content: Record<string, unknown>): string | null {
  if (content.design !== "webinar" || typeof content.designer_html !== "string") return null;
  const html = content.designer_html;
  const channel = typeof content.channel_url === "string" && /^https:\/\/t\.me\/(\+|joinchat\/)[A-Za-z0-9_-]+$/.test(content.channel_url) ? content.channel_url : null;
  const personal = questionnairePersonalChatUrl(content.personal_chat_url);
  if (!channel || !personal || !html.includes("{{bonus_channel_url}}") || !html.includes("{{personal_chat_url}}")) return null;
  return html.split("{{bonus_channel_url}}").join(channel).split("{{personal_chat_url}}").join(personal);
}
