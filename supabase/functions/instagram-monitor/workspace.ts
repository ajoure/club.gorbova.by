import { instagramCsvCell } from "../_shared/instagram-monitor.ts";

export const EXPORT_ENTITIES = [
  "profiles",
  "reels",
  "comments",
  "runs",
] as const;
export function pageNumber(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error("invalid_page");
  }
  return Number(value);
}
export function searchText(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, 200).replace(/[\\%_]/g, "\\$&")
    : "";
}
export async function allRows(factory: () => any): Promise<any[]> {
  const all: any[] = [];
  for (let offset = 0;; offset += 500) {
    const result = await factory().range(offset, offset + 499);
    if (result.error) throw new Error("database_failed");
    all.push(...result.data);
    if (result.data.length < 500) return all;
  }
}
export function exportRows(entity: string, rows: any[]) {
  const definitions: Record<string, [string, string][]> = {
    profiles: [
      ["id", "ID"],
      ["username", "Профиль"],
      ["enabled", "Отслеживать"],
      ["last_checked_at", "Последний сбор"],
      ["created_at", "Добавлен"],
    ],
    reels: [
      ["id", "ID"],
      ["profile_id", "ID профиля"],
      ["post_url", "Ролик"],
      ["caption", "Описание"],
      ["published_at", "Дата"],
      ["transcript", "Дословная расшифровка"],
      ["summary", "AI сводка"],
      ["likes_count", "Лайки"],
      ["collected_comments_count", "Сохранено комментариев"],
      ["comments_count", "Счётчик Instagram"],
      ["comments_coverage", "Покрытие"],
      ["coverage_reason", "Причина неполноты"],
      ["comments_checked_at", "Сбор комментариев"],
    ],
    comments: [
      ["post_url", "Ролик"],
      ["profile_username", "Профиль"],
      ["id", "ID"],
      ["reel_id", "ID ролика"],
      ["provider_comment_id", "ID комментария"],
      ["parent_comment_id", "Родительский комментарий"],
      ["username", "Автор"],
      ["text", "Комментарий"],
      ["posted_at", "Дата"],
      ["likes_count", "Лайки"],
    ],
    runs: [
      ["id", "ID"],
      ["profile_id", "ID профиля"],
      ["reel_id", "ID ролика"],
      ["kind", "Задача"],
      ["status", "Статус"],
      ["created_at", "Запуск"],
      ["cost_usd", "Расход USD"],
      ["error_code", "Ошибка"],
      ["import_offset", "Импортировано строк"],
    ],
  };
  const columns = definitions[entity];
  if (!columns) throw new Error("invalid_entity");
  return {
    headers: columns.map((c) => c[1]),
    rows: rows.map((r) =>
      columns.map(([k]) =>
        String(
          r[k] ?? (k === "post_url"
            ? r.reel?.post_url
            : k === "profile_username"
            ? r.reel?.profile?.username
            : null) ??
            "",
        )
      )
    ),
  };
}
export function exportCsv(entity: string, rows: any[]) {
  const result = exportRows(entity, rows);
  return [result.headers, ...result.rows].map((row) =>
    row.map(instagramCsvCell).join(";")
  ).join("\r\n");
}
