// ============================================================================
// document-filename.ts — pure helpers для рендера human-readable имени файла
// сгенерированного документа.
//
// Канон (PATCH-B): поддерживаются ТОЛЬКО плейсхолдеры формата
//   {{field:FLD-XXXXXX}}
// Любой другой синтаксис {{...}} → warning `file_name_placeholder_invalid_syntax:<raw>`,
// в результирующем имени плейсхолдер заменяется на пустую строку.
// Unresolved FLD (нет в resolvedTokens) → warning `file_name_placeholder_unresolved:FLD-…`,
// тоже пустая строка.
//
// FLD-первый канон не вводит alias-плейсхолдеры (никаких {{document_number}},
// {{payer_short_name}} и т.п.).
//
// Sanitization:
//   - запрещённые в именах файлов символы (/ \ : * ? " < > |) → '-'
//   - control chars удаляются
//   - повторные пробелы схлопываются
//   - длина обрезается до MAX_LEN (UTF-8 safe)
//   - пустой результат → null (вызывающий применит системный дефолт)
// ============================================================================

export const FILENAME_PLACEHOLDER_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
export const FLD_PLACEHOLDER_RE = /^field:(FLD-\d+)$/;
export const FLD_ID_RE = /^FLD-\d+$/;

export const FILENAME_MAX_LEN = 180;
// Минимальный whitelist FLD номера документа (для validation).
// Канонический FLD номера: FLD-000069 (document.number).
export const FILENAME_DOC_NUMBER_FLDS = new Set(['FLD-000069']);

export interface RenderFileNameOptions {
  /** map { 'FLD-000069': 'rendered string', ... } — те же значения, что DOCX. */
  resolvedTokens: Record<string, string>;
}

export interface RenderFileNameResult {
  /** Санитизированное имя без расширения, либо null если пусто. */
  name: string | null;
  warnings: string[];
}

/** Извлекает все плейсхолдеры шаблона; возвращает массив raw-токенов. */
export function extractFilenamePlaceholders(template: string): string[] {
  const out: string[] = [];
  if (!template) return out;
  for (const m of template.matchAll(FILENAME_PLACEHOLDER_RE)) {
    out.push(m[1].trim());
  }
  return out;
}

/** True, если шаблон содержит хотя бы один FLD номера документа из whitelist. */
export function templateHasDocNumberFld(template: string): boolean {
  for (const raw of extractFilenamePlaceholders(template || '')) {
    const m = raw.match(FLD_PLACEHOLDER_RE);
    if (m && FILENAME_DOC_NUMBER_FLDS.has(m[1])) return true;
  }
  return false;
}

/** True, если все плейсхолдеры — валидные `field:FLD-XXXXXX`. */
export function validateFilenameTemplateSyntax(template: string): {
  ok: boolean;
  invalid: string[];
} {
  const invalid: string[] = [];
  for (const raw of extractFilenamePlaceholders(template || '')) {
    if (!FLD_PLACEHOLDER_RE.test(raw)) invalid.push(raw);
  }
  return { ok: invalid.length === 0, invalid };
}

const FORBIDDEN_CHARS_RE = /[\\/:*?"<>|]/g;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;
const MULTISPACE_RE = /\s+/g;

/** Финальная санитизация имени файла (без расширения). */
export function sanitizeFilename(raw: string): string {
  let s = (raw || '');
  s = s.replace(CONTROL_CHARS_RE, '');
  s = s.replace(FORBIDDEN_CHARS_RE, '-');
  s = s.replace(MULTISPACE_RE, ' ').trim();
  // Схлопываем повторные дефисы вокруг пробелов:  «foo - - bar» → «foo - bar».
  s = s.replace(/\s*-\s*-\s*/g, ' - ');
  if (s.length > FILENAME_MAX_LEN) {
    // UTF-8 safe truncate (по code points).
    const arr = Array.from(s);
    s = arr.slice(0, FILENAME_MAX_LEN).join('').trim();
  }
  return s;
}

/**
 * Рендер шаблона имени файла. Возвращает null если итог пустой —
 * вызывающий должен подставить системный дефолт.
 */
export function renderFileName(
  template: string | null | undefined,
  opts: RenderFileNameOptions,
): RenderFileNameResult {
  const warnings: string[] = [];
  if (!template || !template.trim()) {
    return { name: null, warnings };
  }
  const resolved = opts.resolvedTokens || {};
  const out = template.replace(FILENAME_PLACEHOLDER_RE, (_, raw: string) => {
    const r = raw.trim();
    const m = r.match(FLD_PLACEHOLDER_RE);
    if (!m) {
      warnings.push(`file_name_placeholder_invalid_syntax:${r}`);
      return '';
    }
    const fld = m[1];
    const val = resolved[fld];
    if (val === undefined || val === null || String(val).trim() === '') {
      warnings.push(`file_name_placeholder_unresolved:${fld}`);
      return '';
    }
    return String(val);
  });
  const sanitized = sanitizeFilename(out);
  if (!sanitized) {
    warnings.push('file_name_empty_after_render');
    return { name: null, warnings };
  }
  return { name: sanitized, warnings };
}

/** Системный дефолт «{template_name} {document_number} от {document_date}». */
export function buildDefaultFileName(opts: {
  templateName?: string | null;
  documentNumber?: string | null;
  documentDate?: string | null;
}): string {
  const parts: string[] = [];
  if (opts.templateName) parts.push(opts.templateName);
  if (opts.documentNumber) parts.push(`№ ${opts.documentNumber}`);
  if (opts.documentDate) parts.push(`от ${opts.documentDate}`);
  const raw = parts.join(' ') || 'document';
  return sanitizeFilename(raw) || 'document';
}
