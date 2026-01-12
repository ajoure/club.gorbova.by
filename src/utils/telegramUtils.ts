/**
 * Утилиты для работы с Telegram username
 * Нормализация, форматирование и генерация ссылок
 */

/**
 * Очищает и нормализует Telegram username
 * Убирает @, https://t.me/, пробелы и мусор
 * Возвращает null если username невалиден
 */
export function cleanTelegramUsername(raw: string | null | undefined): string | null {
  if (!raw || raw === '-' || raw.trim() === '') return null;
  
  let clean = raw.trim();
  
  // Remove @ at the start
  clean = clean.replace(/^@/, '');
  
  // Remove t.me/ or telegram.me/ prefix (with optional https://)
  clean = clean.replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//i, '');
  
  // If still contains http/https - invalid URL format
  if (/https?:\/\//i.test(clean)) return null;
  
  // Remove spaces and special chars except underscore
  clean = clean.replace(/[^\w]/g, '');
  
  // Empty after cleaning
  if (!clean) return null;
  
  // Telegram username rules: 5-32 chars, starts with letter
  if (clean.length < 5 || clean.length > 32) return null;
  
  return clean.toLowerCase();
}

/**
 * Форматирует username для отображения в UI
 * Добавляет @ в начало
 */
export function formatTelegramDisplay(username: string | null | undefined): string {
  if (!username) return '';
  return `@${username}`;
}

/**
 * Генерирует ссылку на Telegram профиль
 */
export function getTelegramLink(username: string | null | undefined): string | null {
  if (!username) return null;
  return `https://t.me/${username}`;
}
