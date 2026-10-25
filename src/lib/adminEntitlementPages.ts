type EntitlementPage<T> = {
  data: T[] | null;
  count: number | null;
  error: unknown;
};

/** Load the complete admin list; never present a capped/failed read as complete. */
export async function loadAdminEntitlementPages<T extends { id: string }>(
  fetchPage: (from: number, to: number) => PromiseLike<EntitlementPage<T>>,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  const ids = new Set<string>();
  let expectedCount: number | undefined;

  do {
    const page = await fetchPage(rows.length, rows.length + pageSize - 1);
    if (page.error) throw page.error;
    if (!Number.isInteger(page.count) || page.count! < 0 || page.data === null) {
      throw new Error("Не удалось подтвердить полноту списка доступов.");
    }
    expectedCount ??= page.count!;
    if (page.count !== expectedCount) {
      throw new Error("Список доступов изменился во время загрузки. Обновите список.");
    }
    if (page.data.length === 0 && rows.length < expectedCount) {
      throw new Error("Получен неполный список доступов. Обновите список.");
    }
    for (const row of page.data) {
      if (ids.has(row.id)) {
        throw new Error("Список доступов изменился во время загрузки. Обновите список.");
      }
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length > expectedCount) {
      throw new Error("Список доступов изменился во время загрузки. Обновите список.");
    }
  } while (rows.length < expectedCount);

  return rows;
}
