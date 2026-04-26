import { supabase } from "@/integrations/supabase/client";

/**
 * Загружает портфель клиентов ученика из предыдущего урока модуля,
 * содержащего блок diagnostic_table (Шаг 2 «Анализ портфеля»).
 *
 * Возвращает массив строк портфеля в "сыром" виде (как сохранил ученик).
 */
export interface PortfolioRow {
  row_id: string;
  client: string;
  monthly_income: number;
  total_hours: number | null;
  hourly_income: number | null;
  client_category: string | null;
  business_type: string | null;
  source_type: string | null;
}

export interface LoadPortfolioResult {
  rows: PortfolioRow[];
  source_lesson_id: string | null;
  source_lesson_title: string | null;
  source_block_id: string | null;
  empty_reason?: "no_previous_lesson" | "no_user_response" | "no_rows";
}

const NUM = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const STR = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

export async function loadPortfolioFromPreviousLesson(opts: {
  currentLessonId: string;
  userId: string;
  overrideSourceLessonId?: string | null;
}): Promise<LoadPortfolioResult> {
  const { currentLessonId, userId, overrideSourceLessonId } = opts;

  // 1. Текущий урок: модуль и sort_order
  const { data: currentLesson } = await supabase
    .from("training_lessons")
    .select("module_id, sort_order")
    .eq("id", currentLessonId)
    .maybeSingle();

  if (!currentLesson) {
    return {
      rows: [],
      source_lesson_id: null,
      source_lesson_title: null,
      source_block_id: null,
      empty_reason: "no_previous_lesson",
    };
  }

  // 2. Кандидаты — предыдущие уроки модуля
  let candidateLessonId = overrideSourceLessonId || null;
  let candidateLessonTitle: string | null = null;

  if (!candidateLessonId) {
    const { data: prev } = await supabase
      .from("training_lessons")
      .select("id, title, sort_order")
      .eq("module_id", currentLesson.module_id)
      .eq("is_active", true)
      .neq("id", currentLessonId)
      .lt("sort_order", currentLesson.sort_order)
      .order("sort_order", { ascending: false })
      .limit(10);

    if (prev?.length) {
      for (const l of prev) {
        const { data: blocks } = await supabase
          .from("lesson_blocks")
          .select("id")
          .eq("lesson_id", l.id)
          .eq("block_type", "diagnostic_table")
          .limit(1);
        if (blocks?.length) {
          candidateLessonId = l.id;
          candidateLessonTitle = l.title;
          break;
        }
      }
    }
  } else {
    const { data: ll } = await supabase
      .from("training_lessons")
      .select("title")
      .eq("id", candidateLessonId)
      .maybeSingle();
    candidateLessonTitle = ll?.title ?? null;
  }

  if (!candidateLessonId) {
    return {
      rows: [],
      source_lesson_id: null,
      source_lesson_title: null,
      source_block_id: null,
      empty_reason: "no_previous_lesson",
    };
  }

  // 3. Найти diagnostic_table блок этого урока
  const { data: blocks } = await supabase
    .from("lesson_blocks")
    .select("id, content, sort_order")
    .eq("lesson_id", candidateLessonId)
    .eq("block_type", "diagnostic_table")
    .order("sort_order", { ascending: true });

  if (!blocks?.length) {
    return {
      rows: [],
      source_lesson_id: candidateLessonId,
      source_lesson_title: candidateLessonTitle,
      source_block_id: null,
      empty_reason: "no_previous_lesson",
    };
  }

  // 4. Ответы пользователя по этим блокам
  const blockIds = blocks.map((b) => b.id);
  const { data: progress } = await supabase
    .from("user_lesson_progress")
    .select("block_id, response, updated_at")
    .eq("user_id", userId)
    .eq("lesson_id", candidateLessonId)
    .in("block_id", blockIds)
    .order("updated_at", { ascending: false });

  if (!progress?.length) {
    return {
      rows: [],
      source_lesson_id: candidateLessonId,
      source_lesson_title: candidateLessonTitle,
      source_block_id: blocks[0].id,
      empty_reason: "no_user_response",
    };
  }

  // 5. Берём самый "богатый" ответ (с rows)
  let rawRows: Record<string, unknown>[] = [];
  let usedBlockId: string | null = null;
  for (const p of progress) {
    const r = (p.response as { rows?: unknown[] } | null)?.rows;
    if (Array.isArray(r) && r.length) {
      rawRows = r as Record<string, unknown>[];
      usedBlockId = p.block_id;
      break;
    }
  }

  if (!rawRows.length) {
    return {
      rows: [],
      source_lesson_id: candidateLessonId,
      source_lesson_title: candidateLessonTitle,
      source_block_id: blocks[0].id,
      empty_reason: "no_rows",
    };
  }

  const mapped: PortfolioRow[] = rawRows.map((r, idx) => {
    const id = STR((r as Record<string, unknown>).id) || `row_${idx}`;
    const totalHoursRaw = r["total_hours"];
    const direct = NUM(r["direct_hours"]);
    const mental = NUM(r["mental_hours"]);
    const totalHours = totalHoursRaw != null ? NUM(totalHoursRaw) : direct + mental;
    const monthly = NUM(r["monthly_income"]);
    const hourly = totalHours > 0 ? monthly / totalHours : 0;
    return {
      row_id: id,
      client: STR(r["client"]) || `Клиент ${idx + 1}`,
      monthly_income: monthly,
      total_hours: totalHours || null,
      hourly_income: NUM(r["hourly_income"]) || hourly,
      client_category: STR(r["client_category"]) || null,
      business_type: STR(r["business_type"]) || null,
      source_type: STR(r["source_type"]) || null,
    };
  });

  // Фильтруем: только клиенты (не "найм") и с непустым названием
  const onlyClients = mapped.filter(
    (r) => r.client.trim().length > 0 && r.source_type !== "найм"
  );

  return {
    rows: onlyClients.length ? onlyClients : mapped,
    source_lesson_id: candidateLessonId,
    source_lesson_title: candidateLessonTitle,
    source_block_id: usedBlockId,
  };
}
