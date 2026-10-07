export interface InstagramExportPage {
  headers: string[];
  rows: string[][];
  cutoff: string;
  next_cursor: string | null;
}
export const instagramExportEntities = [
  "profiles",
  "reels",
  "comments",
  "runs",
] as const;
export const instagramExportLabels = {
  profiles: "Профили",
  reels: "Ролики",
  comments: "Комментарии",
  runs: "Запуски",
};
export function instagramExportCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = `'${text}`;
  return text;
}
export async function collectInstagramExport(
  fetchPage: (values: Record<string, unknown>) => Promise<InstagramExportPage>,
  entities: readonly string[],
  progress: (rows: number) => void,
  reelId?: string,
  cancelled: () => boolean = () => false,
) {
  const result: Record<string, { headers: string[]; rows: string[][] }> = {};
  let cutoff: string | undefined, count = 0;
  for (const entity of entities) {
    let cursor: string | null = null;
    result[entity] = { headers: [], rows: [] };
    do {
      if (cancelled()) throw new Error("Выгрузка отменена");
      const page = await fetchPage({
        entity,
        cutoff,
        cursor: cursor || undefined,
        reel_id: reelId,
      });
      cutoff = page.cutoff;
      if (!result[entity].headers.length) result[entity].headers = page.headers;
      result[entity].rows.push(...page.rows);
      count += page.rows.length;
      progress(count);
      if (page.next_cursor && page.next_cursor === cursor) {
        throw new Error("Не удалось продолжить выгрузку");
      }
      cursor = page.next_cursor;
    } while (cursor);
  }
  return result;
}
export function saveInstagramFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
export function instagramExportCsv(headers: string[], rows: string[][]) {
  return [headers, ...rows].map((row) =>
    row.map((value) => `"${instagramExportCell(value).replace(/"/g, '""')}"`)
      .join(";")
  ).join("\r\n");
}
export async function instagramWorkbook(
  data: Record<string, { headers: string[]; rows: string[][] }>,
) {
  const XLSX = await import("xlsx"), workbook = XLSX.utils.book_new();
  for (const entity of instagramExportEntities) {
    if (!data[entity]) continue;
    if (data[entity].rows.length > 1_048_575) {
      throw new Error("Превышен лимит строк Excel. Используйте CSV.");
    }
    const sheet = XLSX.utils.aoa_to_sheet([
      data[entity].headers,
      ...data[entity].rows.map((row) => row.map(instagramExportCell)),
    ]);
    XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      instagramExportLabels[entity],
    );
    if (entity === "reels") {
      const indexes = [0, 2, 5, 6];
      const transcripts = XLSX.utils.aoa_to_sheet([
        indexes.map((i) => data[entity].headers[i]),
        ...data[entity].rows.map((row) =>
          indexes.map((i) => instagramExportCell(row[i]))
        ),
      ]);
      XLSX.utils.book_append_sheet(workbook, transcripts, "Расшифровки");
    }
  }
  return XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
}
