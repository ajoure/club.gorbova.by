// ============================================================================
// document-filename.ts — pure helpers для рендера human-readable имени файла
// сгенерированного документа.
//
// Канон (PATCH-B + Sprint 3K):
//   Поддерживаемые плейсхолдеры:
//
//     billing scope (default):
//       {{field:FLD-XXXXXX}}                               — биллинговый FLD
//       {{field:FLD-XXXXXX|format=…|case=…}}               — с модификаторами
//
//     package scope (только для шаблонов document_templates.template_scope='package'):
//       все формы из billing
//       {{package.(ul|ip|fl).FLD-XXXXXX}}                   — реквизиты UL/IP/ФЛ
//       {{package.(ul|ip|fl).FLD-XXXXXX|format=…|case=…}}
//       {{ln-XXXXXX}}                                       — role placeholder
//       {{ln-XXXXXX|format=…|case=…}}
//
// Любой другой синтаксис {{...}} → warning `file_name_placeholder_invalid_syntax:<raw>`,
// в результирующем имени плейсхолдер заменяется на пустую строку.
// Unresolved токен (нет в resolvedTokens) → warning `file_name_placeholder_unresolved:<key>`,
// тоже пустая строка.
//
// Ключи в `resolvedTokens` хранятся БЕЗ внешних `{{ }}` и БЕЗ модификаторов:
//   'FLD-000069', 'package.ul.FLD-000011', 'ln-000012'
// Это позволяет оркестратору переиспользовать ту же мапу, что и для тела
// документа (см. canonical-document-generate-strict + _shared/resolve-package-tokens.ts),
// добавляя ключи модификаторов опционально (см. ниже fallback).
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

export type FilenameScope = 'billing' | 'package';

export const FILENAME_PLACEHOLDER_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

// Внутренний слой плейсхолдера (без `{{ }}`) — три формы:
//   field:FLD-XXXXXX[|key=val]*
//   package.(ul|ip|fl).FLD-XXXXXX[|key=val]*
//   ln-XXXXXX[|key=val]*
const FLD_PLACEHOLDER_RE = /^field:(FLD-\d{6})((?:\|[a-z_]+=[a-z_]+)*)$/;
const PACKAGE_PLACEHOLDER_RE = /^package\.(ul|ip|fl)\.(FLD-\d{6})((?:\|[a-z_]+=[a-z_]+)*)$/;
const LN_PLACEHOLDER_RE = /^(ln-\d{6})((?:\|[a-z_]+=[a-z_]+)*)$/;
export { FLD_PLACEHOLDER_RE };
export const FLD_ID_RE = /^FLD-\d+$/;

export const FILENAME_MAX_LEN = 180;
// Whitelist FLD номера документа (для информационного warning'а в UI).
// Канонический FLD номера: FLD-000069 (document.number).
// Sprint 3K: FLD-000069 больше НЕ обязателен для активации/сохранения шаблона —
// только информационная подсказка.
export const FILENAME_DOC_NUMBER_FLDS = new Set(['FLD-000069']);

export interface RenderFileNameOptions {
  /**
   * map { 'FLD-000069': 'rendered string', 'package.ul.FLD-000011': '...',
   *       'ln-000012': '...', ... }  — те же значения, что DOCX.
   * Для токенов с модификаторами оркестратор может опционально записать
   * вариант с полным ключом (`'package.ul.FLD-000014|format=short'`) —
   * рендерер сначала ищет полный ключ, потом базовый.
   */
  resolvedTokens: Record<string, string>;
  /** Default 'billing' — обратная совместимость. */
  scope?: FilenameScope;
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

/**
 * True, если все плейсхолдеры соответствуют допустимой grammar для данного scope.
 * Sprint 3K: для `package`-scope валидны package/ln-токены с модификаторами;
 * для `billing` остаётся только `field:FLD-XXXXXX[|...]`.
 */
export function validateFilenameTemplateSyntax(
  template: string,
  scope: FilenameScope = 'billing',
): { ok: boolean; invalid: string[] } {
  const invalid: string[] = [];
  for (const raw of extractFilenamePlaceholders(template || '')) {
    if (FLD_PLACEHOLDER_RE.test(raw)) continue;
    if (scope === 'package' && (PACKAGE_PLACEHOLDER_RE.test(raw) || LN_PLACEHOLDER_RE.test(raw))) continue;
    invalid.push(raw);
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
 * Резолв одного raw-плейсхолдера. Возвращает либо строку для подстановки,
 * либо warning-код.
 */
function resolveToken(
  raw: string,
  scope: FilenameScope,
  resolved: Record<string, string>,
): { ok: true; value: string } | { ok: false; warning: string } {
  // 1) {{field:FLD-XXXXXX[|...]}}
  let m = raw.match(FLD_PLACEHOLDER_RE);
  if (m) {
    const fld = m[1];
    // Сначала ищем точный ключ (с модификаторами), потом базовый FLD.
    const exact = resolved[raw] ?? resolved[fld];
    if (exact === undefined || exact === null || String(exact).trim() === '') {
      return { ok: false, warning: `file_name_placeholder_unresolved:${fld}` };
    }
    return { ok: true, value: String(exact) };
  }

  // 2) package/ln — только в package scope
  if (scope === 'package') {
    m = raw.match(PACKAGE_PLACEHOLDER_RE);
    if (m) {
      const base = `package.${m[1]}.${m[2]}`;
      const val = resolved[raw] ?? resolved[base];
      if (val === undefined || val === null || String(val).trim() === '') {
        return { ok: false, warning: `file_name_placeholder_unresolved:${base}` };
      }
      return { ok: true, value: String(val) };
    }
    m = raw.match(LN_PLACEHOLDER_RE);
    if (m) {
      const base = m[1];
      const val = resolved[raw] ?? resolved[base];
      if (val === undefined || val === null || String(val).trim() === '') {
        return { ok: false, warning: `file_name_placeholder_unresolved:${base}` };
      }
      return { ok: true, value: String(val) };
    }
  }

  return { ok: false, warning: `file_name_placeholder_invalid_syntax:${raw}` };
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
  const scope: FilenameScope = opts.scope ?? 'billing';
  const out = template.replace(FILENAME_PLACEHOLDER_RE, (_, raw: string) => {
    const r = raw.trim();
    const res = resolveToken(r, scope, resolved);
    if (!res.ok) {
      warnings.push(res.warning);
      return '';
    }
    return res.value;
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
