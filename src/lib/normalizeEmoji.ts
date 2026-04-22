/**
 * Render-time emoji shortcode normalization.
 *
 * - НЕ меняет SoT в БД. Только трансформация текста при рендере.
 * - Управляется тогглом room_settings.chat.emoji_normalization_enabled.
 * - Безопасный whitelist распространённых shortcodes; неизвестные оставляем как есть.
 */

const EMOJI_MAP: Record<string, string> = {
  ":)": "🙂",
  ":-)": "🙂",
  ":(": "🙁",
  ":-(": "🙁",
  ":D": "😄",
  ":-D": "😄",
  ":P": "😛",
  ":-P": "😛",
  ";)": "😉",
  ";-)": "😉",
  ":o": "😮",
  ":O": "😮",
  "<3": "❤️",
  "</3": "💔",
  ":heart:": "❤️",
  ":fire:": "🔥",
  ":thumbsup:": "👍",
  ":+1:": "👍",
  ":thumbsdown:": "👎",
  ":-1:": "👎",
  ":clap:": "👏",
  ":ok:": "👌",
  ":star:": "⭐",
  ":check:": "✅",
  ":cross:": "❌",
  ":warning:": "⚠️",
  ":eyes:": "👀",
  ":wave:": "👋",
  ":smile:": "😊",
  ":sad:": "😢",
  ":party:": "🎉",
  ":rocket:": "🚀",
  ":100:": "💯",
};

// Sorted: longer first to avoid partial replacement (e.g. ":-)" before ":)").
const KEYS = Object.keys(EMOJI_MAP).sort((a, b) => b.length - a.length);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PATTERN = new RegExp(KEYS.map(escapeRegExp).join("|"), "g");

export function normalizeEmoji(text: string, enabled: boolean): string {
  if (!enabled || !text) return text;
  return text.replace(PATTERN, (m) => EMOJI_MAP[m] ?? m);
}
