import { QUESTIONNAIRE_SOURCES, parseQuestionnaireSource } from "../../supabase/functions/site-form-submit/questionnaire-source";

const labels: Record<string, string> = {
  telegram: "Телеграм", instagram: "Инстаграм", email: "Почта", club: "Клуб",
  cb21_preregistration: "Предзапись ЦБ — 21 поток",
  anketa_osn: "Основная", anketa_ank: "Анкета", anketa_dop: "Дополнительная",
};

/** Display labels only: preserve original attribution for grouping and copied links. */
export function questionnaireAttributionLabel(value?: string): string {
  if (!value) return "—";
  const code = value.toLowerCase();
  const source = parseQuestionnaireSource(code);
  return source ? QUESTIONNAIRE_SOURCES[source].label : labels[code] || value;
}
