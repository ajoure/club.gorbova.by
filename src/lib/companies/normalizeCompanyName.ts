const LEGAL_FORM_PATTERN = /^(ООО|ОДО|ЗАО|ОАО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП)(?=\s|$)/i;

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
    value = value.replace(/^(ООО|ОДО|ЗАО|ОАО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП)\s*[,;:\-]?\s*/i, "");
  } else {
    value = value.replace(/\s*,?\s*(ООО|ОДО|ЗАО|ОАО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП)\s*$/i, "");
  }

  // Imported branch names occasionally contain the legal form in the middle
  // (for example, `ф-л ОАО ...`). It is metadata, not part of the display
  // name, so remove standalone OPF tokens everywhere after edge cleanup.
  value = value.replace(/(^|[^\p{L}\p{N}])(ООО|ОДО|ЗАО|ОАО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП)(?=$|[^\p{L}\p{N}])/giu, "$1");
  return value.replace(/\s*,\s*,/g, ",").replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "").replace(/\s{2,}/g, " ").trim();
}

export function inferCompanyLegalForm(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").replace(/[«»“”„‟\"]/g, "").replace(/\s+/g, " ").trim();
  const prefix = value.match(LEGAL_FORM_PATTERN)?.[1];
  if (prefix) return prefix.toUpperCase();
  const suffix = value.match(/,?\s*(ООО|ОДО|ЗАО|ОАО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП)\s*$/i)?.[1];
  return suffix ? suffix.toUpperCase() : null;
}
