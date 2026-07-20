const LEGAL_FORM_PATTERN = /^(ООО|ОДО|ЗАО|ОАО|СООО|УП|ЧУП|КУП|ТУП|ИП)(?=\s|$)/i;

/**
 * Keeps imported company names readable and leaves the legal form in its own
 * field. The source spreadsheet contains a mixture of straight/curly quotes,
 * duplicated quotes and names with the form at either edge.
 */
export function normalizeCompanyName(raw: string | null | undefined): string {
  let value = String(raw ?? "")
    .replace(/[«»“”„‟\"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  value = value.replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "").trim();
  if (LEGAL_FORM_PATTERN.test(value)) {
    value = value.replace(/^(ООО|ОДО|ЗАО|ОАО|СООО|УП|ЧУП|КУП|ТУП|ИП)\s*[,;:\-]?\s*/i, "");
  } else {
    value = value.replace(/\s*,?\s*(ООО|ОДО|ЗАО|ОАО|СООО|УП|ЧУП|КУП|ТУП|ИП)\s*$/i, "");
  }

  return value.replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "").trim();
}

export function inferCompanyLegalForm(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").replace(/[«»“”„‟\"]/g, "").replace(/\s+/g, " ").trim();
  const prefix = value.match(LEGAL_FORM_PATTERN)?.[1];
  if (prefix) return prefix.toUpperCase();
  const suffix = value.match(/,?\s*(ООО|ОДО|ЗАО|ОАО|СООО|УП|ЧУП|КУП|ТУП|ИП)\s*$/i)?.[1];
  return suffix ? suffix.toUpperCase() : null;
}
