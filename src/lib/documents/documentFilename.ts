/**
 * documentFilename — frontend mirror supabase/functions/_shared/document-filename.ts.
 * Используется в UI редактора шаблона имени файла (live-preview, validation).
 */

export const FILENAME_PLACEHOLDER_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
export const FLD_PLACEHOLDER_RE = /^field:(FLD-\d+)$/;
export const FILENAME_MAX_LEN = 180;
export const FILENAME_DOC_NUMBER_FLDS = new Set(["FLD-000069"]);

export function extractFilenamePlaceholders(template: string): string[] {
  const out: string[] = [];
  if (!template) return out;
  for (const m of template.matchAll(FILENAME_PLACEHOLDER_RE)) {
    out.push(m[1].trim());
  }
  return out;
}

export function templateHasDocNumberFld(template: string): boolean {
  for (const raw of extractFilenamePlaceholders(template || "")) {
    const m = raw.match(FLD_PLACEHOLDER_RE);
    if (m && FILENAME_DOC_NUMBER_FLDS.has(m[1])) return true;
  }
  return false;
}

export function validateFilenameTemplateSyntax(template: string): {
  ok: boolean;
  invalid: string[];
} {
  const invalid: string[] = [];
  for (const raw of extractFilenamePlaceholders(template || "")) {
    if (!FLD_PLACEHOLDER_RE.test(raw)) invalid.push(raw);
  }
  return { ok: invalid.length === 0, invalid };
}

const FORBIDDEN_CHARS_RE = /[\\/:*?"<>|]/g;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;
const MULTISPACE_RE = /\s+/g;

export function sanitizeFilename(raw: string): string {
  let s = raw || "";
  s = s.replace(CONTROL_CHARS_RE, "");
  s = s.replace(FORBIDDEN_CHARS_RE, "-");
  s = s.replace(MULTISPACE_RE, " ").trim();
  s = s.replace(/\s*-\s*-\s*/g, " - ");
  if (s.length > FILENAME_MAX_LEN) {
    s = Array.from(s).slice(0, FILENAME_MAX_LEN).join("").trim();
  }
  return s;
}

export interface RenderFileNameResult {
  name: string | null;
  warnings: string[];
}

export function renderFileName(
  template: string | null | undefined,
  resolvedTokens: Record<string, string>,
): RenderFileNameResult {
  const warnings: string[] = [];
  if (!template || !template.trim()) return { name: null, warnings };
  const out = template.replace(FILENAME_PLACEHOLDER_RE, (_, raw: string) => {
    const r = raw.trim();
    const m = r.match(FLD_PLACEHOLDER_RE);
    if (!m) {
      warnings.push(`file_name_placeholder_invalid_syntax:${r}`);
      return "";
    }
    const fld = m[1];
    const val = resolvedTokens[fld];
    if (val === undefined || val === null || String(val).trim() === "") {
      warnings.push(`file_name_placeholder_unresolved:${fld}`);
      return "";
    }
    return String(val);
  });
  const sanitized = sanitizeFilename(out);
  if (!sanitized) {
    warnings.push("file_name_empty_after_render");
    return { name: null, warnings };
  }
  return { name: sanitized, warnings };
}
