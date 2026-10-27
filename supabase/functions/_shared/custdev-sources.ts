import type { CustdevDb } from "./custdev-storage.ts";
import { calculateV2Computed } from "./diagnostic-table-v2.ts";
import type {
  PortfolioClient,
  SourceProduct,
  Sources,
} from "./custdev-contract.ts";

type Row = Record<string, unknown>;
export interface LessonSource {
  id: string;
  title: string;
  sort_order: number;
  blocks: { id: string; block_type: string; content: Row }[];
  state: Row;
  responses: Record<string, Row>;
}
const str = (v: unknown) => typeof v === "string" ? v : "";

/** No source writes, invented categories, row-index IDs or duplicate portfolio tables. */
export function buildSources(
  lessons: LessonSource[],
  settings: Row = {},
): Sources {
  const result: Sources = {
    portfolio: [],
    products: [],
    context: {},
    lessons: lessons.map((l) => ({ id: l.id, title: l.title })),
    warnings: [],
  };
  const ordered = [...lessons].sort((a, b) => b.sort_order - a.sort_order);
  for (const l of ordered) {
    const blocks = l.blocks.filter((b) => b.block_type === "diagnostic_table");
    if (
      !blocks.length ||
      (settings.source_portfolio_lesson_id &&
        settings.source_portfolio_lesson_id !== l.id)
    ) continue;
    const block = blocks.find((b) =>
      settings.source_portfolio_block_id === b.id
    ) ?? blocks.find((b) => b.content.version === "v2") ?? blocks[0];
    const raw = [
      l.state.pointA_v2_rows,
      l.state.pointA_rows,
      l.responses[block.id]?.rows,
    ].find((v) => Array.isArray(v) && v.length);
    if (!Array.isArray(raw) || !raw.length) continue;
    const rows = raw as Row[], seen = new Set<string>();
    for (const r of rows) {
      if (r.source_type === "найм" || !str(r.client).trim()) continue;
      const id = str(r._id) || str(r.id);
      if (!id || seen.has(id)) {
        result.warnings.push(
          "В портфеле есть строки без постоянного ID или с повторным ID. Сохраните их в Шаге 2; пока их можно добавить как ручных респондентов.",
        );
        continue;
      }
      seen.add(id);
      const category = calculateV2Computed(r, rows).client_category ||
        str(r.client_category) || null;
      result.portfolio.push(
        {
          id,
          name: str(r.client),
          category,
          ref: { lessonId: l.id, blockId: block.id, clientId: id },
        } satisfies PortfolioClient,
      );
    }
    break;
  }
  for (const l of ordered) {
    if (
      settings.source_product_lesson_id &&
      settings.source_product_lesson_id !== l.id
    ) continue;
    const b = l.blocks.find((b) =>
      b.block_type === "external_product_workshop"
    );
    if (!b) continue;
    const response = l.responses[b.id] ?? {},
      state = (response.state ?? response) as Row;
    for (
      const [key, kind] of [
        ["client_types", "client_type"],
        ["complexity", "complexity"],
        ["service_levels", "service"],
        ["responsibility", "responsibility"],
      ] as const
    ) {
      if (!Array.isArray(state[key])) continue;
      for (const value of state[key] as Row[]) {
        if (str(value.id) && str(value.name).trim()) {
          result.products.push(
            {
              id: str(value.id),
              name: str(value.name),
              description: [str(value.description), str(value.conclusion)]
                .filter(Boolean).join("\n"),
              kind,
            } satisfies SourceProduct,
          );
        }
      }
    }
    break;
  }
  for (const l of ordered) {
    if (
      settings.source_context_lesson_id &&
      settings.source_context_lesson_id !== l.id
    ) continue;
    if (
      !l.blocks.some((b) =>
        b.block_type === "sequential_form" || b.block_type === "quiz_survey"
      )
    ) continue;
    result.context = {
      lesson_title: l.title,
      role: l.state.role ?? null,
      answers: l.state.pointB_answers ??
        Object.fromEntries(
          l.blocks.filter((b) =>
            b.block_type === "sequential_form" || b.block_type === "quiz_survey"
          ).map((b) => [b.id, l.responses[b.id] ?? {}]),
        ),
    };
    break;
  }
  if (!result.portfolio.length) {
    result.warnings.push(
      "Портфель не заполнен: респондентов можно добавить вручную.",
    );
  }
  if (!result.products.length) {
    result.warnings.push(
      "Нет заполненной продуктовой матрицы: соответствие продукту требует проверки.",
    );
  }
  return result;
}

/** Reads only this learner's responses inside the same preceding module lessons. */
export async function loadSources(
  db: CustdevDb,
  owner: string,
  lesson: { id: string; module_id: string; sort_order: number },
  settings: Row,
): Promise<Sources> {
  const { data: lessons, error } = await db.from<
    { id: string; title: string; sort_order: number }
  >("training_lessons").select(
    "id,title,sort_order",
  ).eq("module_id", lesson.module_id).lt("sort_order", lesson.sort_order).order(
    "sort_order",
    { ascending: true },
  );
  if (error) throw new Error("Не удалось прочитать предыдущие уроки");
  const ids = (lessons ?? []).map((l: Row) => l.id);
  if (!ids.length) return buildSources([], settings);
  const [blocks, states, responses] = await Promise.all([
    db.from<
      { id: string; lesson_id: string; block_type: string; content: Row }
    >("lesson_blocks").select("id,lesson_id,block_type,content").in(
      "lesson_id",
      ids,
    ).order("sort_order"),
    db.from<{ lesson_id: string; state_json: Row }>("lesson_progress_state")
      .select("lesson_id,state_json").eq(
        "user_id",
        owner,
      ).in("lesson_id", ids),
    db.from<{ lesson_id: string; block_id: string; response: Row }>(
      "user_lesson_progress",
    ).select("lesson_id,block_id,response").eq(
      "user_id",
      owner,
    ).in("lesson_id", ids),
  ]);
  if (blocks.error || states.error || responses.error) {
    throw new Error("Не удалось прочитать ответы предыдущих шагов");
  }
  return buildSources(
    (lessons ?? []).map((l) => ({
      ...l,
      blocks: (blocks.data ?? []).filter((b: Row) => b.lesson_id === l.id),
      state: states.data?.find((s: Row) => s.lesson_id === l.id)?.state_json ??
        {},
      responses: Object.fromEntries(
        (responses.data ?? []).filter((r: Row) => r.lesson_id === l.id).map((
          r: Row,
        ) => [r.block_id, r.response ?? {}]),
      ),
    })),
    settings,
  );
}
