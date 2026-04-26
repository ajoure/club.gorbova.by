/**
 * Shared block progress resolver.
 * Single source of truth for resolving user responses by block_type.
 * Used by AdminLessonProgress (table cells) and StudentProgressModal (detail view).
 *
 * Rules:
 * - All lookups by block_id (UUID), never by title/text
 * - Unsupported block_type → safe fallback, never crash
 * - Same block_type renders identically in table and modal
 */

export interface BlockMeta {
  id: string;
  block_type: string;
  content: unknown;
  sort_order?: number;
}

/** Which block types are interactive (accept user input) */
const INTERACTIVE_BLOCK_TYPES = new Set([
  "input_short",
  "file_upload",
  "quiz_single",
  "quiz_survey",
  "sequential_form",
  "diagnostic_table",
  "checklist",
  "rating",
  "table_input",
  "quiz_multiple",
  "quiz_true_false",
  "role_description",
  "external_product_workshop",
]);

export function isInteractiveBlock(blockType: string): boolean {
  return INTERACTIVE_BLOCK_TYPES.has(blockType);
}

/** Filter lesson blocks to only interactive ones, sorted by sort_order */
export function getInteractiveBlocks(blocks: BlockMeta[]): BlockMeta[] {
  return blocks
    .filter((b) => isInteractiveBlock(b.block_type))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/**
 * Strip HTML tags from a string, decode common entities, normalize whitespace.
 * Used exclusively for display-only labels — never for rich-text content rendering.
 */
function stripHtmlForLabel(html: string): string {
  let text = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

/** Get display label for a block (title from content, fallback to type).
 *  Sanitizes HTML so labels render as plain text in tables/modals/drawers. */
export function getBlockLabel(block: BlockMeta): string {
  const content = block.content as Record<string, unknown> | null;
  if (content?.title && typeof content.title === "string") {
    const clean = stripHtmlForLabel(content.title);
    if (clean) return clean;
  }
  if (content?.label && typeof content.label === "string") {
    const clean = stripHtmlForLabel(content.label);
    if (clean) return clean;
  }
  return blockTypeLabel(block.block_type);
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  input_short: "Текстовый ответ",
  file_upload: "Загрузка файла",
  quiz_single: "Тест",
  quiz_multiple: "Тест (множ.)",
  quiz_true_false: "Верно/Неверно",
  quiz_survey: "Опрос",
  sequential_form: "Пошаговая форма",
  diagnostic_table: "Диагностическая таблица",
  checklist: "Чек-лист",
  rating: "Оценка",
  table_input: "Таблица",
  role_description: "Выбор роли",
  external_product_workshop: "Воркшоп: внешний продукт",
};

export function blockTypeLabel(blockType: string): string {
  return BLOCK_TYPE_LABELS[blockType] || blockType;
}

// ─── Response resolution ───

export interface ResolvedValue {
  /** Has user provided any response? */
  hasResponse: boolean;
  /** Short summary for table cell (≤40 chars) */
  summary: string;
  /** Whether response is "correct" (for quiz types) */
  isCorrect?: boolean;
}

/**
 * Resolve a user's response for a given block into a display-friendly format.
 * Works with both user_lesson_progress.response and lesson_progress_state fields.
 */
export function resolveProgressValue(
  blockType: string,
  response: unknown,
  _blockContent?: unknown
): ResolvedValue {
  if (response === null || response === undefined) {
    return { hasResponse: false, summary: "—" };
  }

  const resp = response as Record<string, unknown>;

  switch (blockType) {
    case "input_short":
      return resolveInputShort(resp);
    case "file_upload":
      return resolveFileUpload(resp);
    case "quiz_single":
    case "quiz_multiple":
    case "quiz_true_false":
      return resolveQuiz(resp);
    case "quiz_survey":
      return resolveQuizSurvey(resp);
    case "sequential_form":
      return resolveSequentialForm(resp);
    case "diagnostic_table":
      return resolveDiagnosticTable(resp);
    case "checklist":
      return resolveChecklist(resp);
    case "rating":
      return resolveRating(resp);
    case "table_input":
      return resolveTableInput(resp);
    case "role_description":
      return resolveRoleDescription(resp);
    case "external_product_workshop":
      return resolveExternalProductWorkshop(resp);
    default:
      // Fallback for unsupported interactive types
      return { hasResponse: true, summary: "✓ есть ответ" };
  }
}

// ─── Per-type resolvers ───

function resolveInputShort(resp: Record<string, unknown>): ResolvedValue {
  const text = (resp.text as string) || (resp.value as string) || "";
  if (!text.trim()) return { hasResponse: false, summary: "—" };
  const trimmed = text.trim();
  return {
    hasResponse: true,
    summary: trimmed.length > 40 ? trimmed.slice(0, 37) + "…" : trimmed,
  };
}

function resolveFileUpload(resp: Record<string, unknown>): ResolvedValue {
  const files = resp.files as unknown[];
  const file = resp.file as Record<string, unknown> | undefined;
  const count = Array.isArray(files) ? files.length : file?.storage_path ? 1 : 0;
  if (count === 0) return { hasResponse: false, summary: "—" };
  return {
    hasResponse: true,
    summary: `📎 ${count} файл${count === 1 ? "" : count < 5 ? "а" : "ов"}`,
  };
}

function resolveQuiz(resp: Record<string, unknown>): ResolvedValue {
  const selected = resp.selected_options || resp.selected || resp.answer;
  if (!selected) return { hasResponse: false, summary: "—" };
  const isCorrect = resp.is_correct as boolean | undefined;
  const labels = Array.isArray(selected)
    ? (selected as string[]).join(", ")
    : String(selected);
  const short = labels.length > 30 ? labels.slice(0, 27) + "…" : labels;
  return {
    hasResponse: true,
    summary: isCorrect === true ? `✓ ${short}` : isCorrect === false ? `✗ ${short}` : short,
    isCorrect,
  };
}

function resolveQuizSurvey(resp: Record<string, unknown>): ResolvedValue {
  const selected = resp.selected || resp.answer || resp.value;
  if (!selected) return { hasResponse: false, summary: "—" };
  const label = typeof selected === "string" ? selected : JSON.stringify(selected);
  return {
    hasResponse: true,
    summary: label.length > 40 ? label.slice(0, 37) + "…" : label,
  };
}

function resolveSequentialForm(resp: Record<string, unknown>): ResolvedValue {
  // resp could be { answers: {...}, completed: true } or just the answers object
  const answers = (resp.answers || resp) as Record<string, unknown>;
  const keys = Object.keys(answers).filter((k) => k !== "completed" && k !== "type");
  if (keys.length === 0) return { hasResponse: false, summary: "—" };
  return {
    hasResponse: true,
    summary: `📝 ${keys.length} ответ${keys.length === 1 ? "" : keys.length < 5 ? "а" : "ов"}`,
  };
}

function resolveDiagnosticTable(resp: Record<string, unknown>): ResolvedValue {
  const rows = (resp.rows || resp.data) as unknown[];
  if (!Array.isArray(rows) || rows.length === 0) return { hasResponse: false, summary: "—" };
  return {
    hasResponse: true,
    summary: `📊 ${rows.length} строк`,
  };
}

function resolveChecklist(resp: Record<string, unknown>): ResolvedValue {
  const items = (resp.checked || resp.items || resp.selected) as unknown[];
  if (!Array.isArray(items) || items.length === 0) return { hasResponse: false, summary: "—" };
  return {
    hasResponse: true,
    summary: `☑ ${items.length} пункт${items.length === 1 ? "" : items.length < 5 ? "а" : "ов"}`,
  };
}

function resolveRating(resp: Record<string, unknown>): ResolvedValue {
  const value = resp.value || resp.rating;
  if (value === null || value === undefined) return { hasResponse: false, summary: "—" };
  return {
    hasResponse: true,
    summary: `⭐ ${value}`,
  };
}

function resolveTableInput(resp: Record<string, unknown>): ResolvedValue {
  const rows = (resp.rows || resp.data) as unknown[];
  if (!Array.isArray(rows) || rows.length === 0) return { hasResponse: false, summary: "—" };
  return {
    hasResponse: true,
    summary: `📋 ${rows.length} строк`,
  };
}

function resolveRoleDescription(resp: Record<string, unknown>): ResolvedValue {
  const role = resp.role || resp.selected || resp.value;
  if (!role) return { hasResponse: false, summary: "—" };
  const ROLE_LABELS: Record<string, string> = {
    executor: "Исполнитель",
    freelancer: "Фрилансер",
    entrepreneur: "Предприниматель",
  };
  const label = typeof role === "string" ? ROLE_LABELS[role] || role : String(role);
  return { hasResponse: true, summary: label };
}

function resolveExternalProductWorkshop(resp: Record<string, unknown>): ResolvedValue {
  const state = (resp.state as Record<string, unknown>) || resp;
  const types = (state.client_types as unknown[]) || [];
  const portfolio = (state.portfolio_pricing as unknown[]) || [];
  const completed = !!(resp.is_submitted || state.completed_at);
  const filledTypes = (types as Record<string, unknown>[]).filter(
    (t) => typeof t.name === "string" && t.name.trim().length > 0
  ).length;
  if (filledTypes === 0 && portfolio.length === 0) {
    return { hasResponse: false, summary: "—" };
  }
  return {
    hasResponse: true,
    summary: `${completed ? "✓ " : ""}Типов: ${filledTypes} · Клиентов: ${portfolio.length}`,
  };
}
