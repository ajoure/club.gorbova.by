import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  collectInstagramExport,
  instagramExportCsv,
  instagramWorkbook,
} from "./instagramWorkspaceExport";
describe("Instagram full workspace export", () => {
  it("continues through every page beyond old 1000-row cap with a shared cutoff", async () => {
    const calls: Record<string, unknown>[] = [];
    const data = await collectInstagramExport(
      async (values) => {
        calls.push(values);
        const offset = values.cursor ? Number(values.cursor) : 0;
        return {
          headers: ["Текст"],
          rows: Array.from(
            { length: Math.min(500, 1203 - offset) },
            (_, i) => [String(offset + i)],
          ),
          cutoff: "2026-10-06T00:00:00Z",
          next_cursor: offset + 500 < 1203 ? String(offset + 500) : null,
        };
      },
      ["comments"],
      () => {},
    );
    expect(data.comments.rows).toHaveLength(1203);
    expect(data.comments.rows[1202]).toEqual(["1202"]);
    expect(calls[1].cutoff).toBe("2026-10-06T00:00:00Z");
  });
  it("writes all five sheets and keeps formula-looking comments inert", async () => {
    const data = {
      profiles: { headers: ["Имя"], rows: [["competitor"]] },
      reels: {
        headers: [
          "ID",
          "Профиль",
          "URL",
          "Текст",
          "Дата",
          "Транскрипт",
          "Сводка",
        ],
        rows: [[
          "1",
          "p",
          "https://instagram.com/p/example",
          "caption",
          "date",
          "speech",
          "summary",
        ]],
      },
      comments: {
        headers: ["Текст"],
        rows: [['=WEBSERVICE("https://invalid.test")'], ["@SUM(1)"], [
          'строка\nс кавычкой "',
        ]],
      },
      runs: { headers: ["ID"], rows: [["run"]] },
    };
    const workbook = XLSX.read(await instagramWorkbook(data), {
      type: "array",
    });
    expect(workbook.SheetNames).toEqual([
      "Профили",
      "Ролики",
      "Расшифровки",
      "Комментарии",
      "Запуски",
    ]);
    expect(workbook.Sheets["Комментарии"].A2.t).toBe("s");
    expect(workbook.Sheets["Комментарии"].A2.f).toBeUndefined();
    expect(
      XLSX.utils.sheet_to_json(workbook.Sheets["Расшифровки"], { header: 1 }),
    ).toEqual([["ID", "URL", "Транскрипт", "Сводка"], [
      "1",
      "https://instagram.com/p/example",
      "speech",
      "summary",
    ]]);
    expect(instagramExportCsv(data.comments.headers, data.comments.rows))
      .toContain("'@SUM(1)");
    expect(instagramExportCsv(data.comments.headers, data.comments.rows))
      .toContain('"строка\nс кавычкой """');
  });
  it("supports cancellation before another page and detects a stuck cursor", async () => {
    await expect(collectInstagramExport(
      async () => {
        throw Error("should not fetch");
      },
      ["comments"],
      () => {},
      undefined,
      () => true,
    )).rejects.toThrow("отменена");
    await expect(
      collectInstagramExport(
        async () => ({
          headers: [],
          rows: [],
          cutoff: "date",
          next_cursor: "same",
        }),
        ["comments"],
        () => {},
      ),
    ).rejects.toThrow("продолжить");
  });
});
