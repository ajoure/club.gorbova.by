const LEGAL_FORM_PATTERN = /^(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)(?=\s|$)/i;
const LEGAL_FORM_TOKEN_PATTERN = "ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП";
const LEGAL_FORM_PHRASES = [
  { phrase: "общество с ограниченной ответственностью", code: "ООО" },
  { phrase: "закрытое акционерное общество", code: "ЗАО" },
  { phrase: "открытое акционерное общество", code: "ОАО" },
  { phrase: "публичное акционерное общество", code: "ПАО" },
  { phrase: "акционерное общество", code: "АО" },
  { phrase: "частное унитарное предприятие", code: "ЧУП" },
] as const;
const QUOTE_PATTERN = /[«»“”„‟"'‘’`]/g;

function phrasePattern(): RegExp {
  return new RegExp(LEGAL_FORM_PHRASES.map(({ phrase }) => phrase.replace(/\s+/g, "\\s+")).join("|"), "i");
}

function phraseCode(raw: string): string | null {
  const value = raw.toLocaleLowerCase("ru-RU");
  return LEGAL_FORM_PHRASES.find(({ phrase }) => value.includes(phrase))?.code ?? null;
}

/**
 * Keeps imported company names readable and leaves the legal form in its own
 * field. The source spreadsheet contains a mixture of straight/curly quotes,
 * duplicated quotes and names with the form at either edge.
 */
export function normalizeCompanyName(raw: string | null | undefined): string {
  let value = String(raw ?? "")
    .replace(QUOTE_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();

  value = value.replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "").trim();
  const phrases = phrasePattern();
  value = value.replace(new RegExp(`^(${phrases.source})\\s*[,;:\-]?\\s*`, "i"), "");
  value = value.replace(new RegExp(`,?\\s*(${phrases.source})\\s*$`, "i"), "");
  if (LEGAL_FORM_PATTERN.test(value)) {
    value = value.replace(new RegExp(`^(${LEGAL_FORM_TOKEN_PATTERN})\\s*[,;:\\-]?\\s*`, "i"), "");
  } else {
    value = value.replace(new RegExp(`\\s*,?\\s*(${LEGAL_FORM_TOKEN_PATTERN})\\s*$`, "i"), "");
  }

  // Imported branch names occasionally contain the legal form in the middle
  // (for example, `ф-л ОАО ...`). It is metadata, not part of the display
  // name, so remove standalone OPF tokens everywhere after edge cleanup.
  value = value.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(${LEGAL_FORM_TOKEN_PATTERN})(?=$|[^\\p{L}\\p{N}])`, "giu"), "$1");
  value = value.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(${phrases.source})(?=$|[^\\p{L}\\p{N}])`, "giu"), "$1");
  return value.replace(/\s*,\s*,/g, ",").replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "").replace(/\s{2,}/g, " ").trim();
}

export function inferCompanyLegalForm(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").replace(QUOTE_PATTERN, "").replace(/\s+/g, " ").trim();
  const phrase = phraseCode(value);
  if (phrase) return phrase;
  const prefix = value.match(LEGAL_FORM_PATTERN)?.[1];
  if (prefix) return prefix.toUpperCase();
  const suffix = value.match(new RegExp(`,?\\s*(${LEGAL_FORM_TOKEN_PATTERN})\\s*$`, "i"))?.[1];
  return suffix ? suffix.toUpperCase() : null;
}
