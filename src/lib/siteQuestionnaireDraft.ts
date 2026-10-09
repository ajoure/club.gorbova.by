import {
  parseQuestionnaireSource,
  type QuestionnaireSource,
} from "../../supabase/functions/site-form-submit/questionnaire-source";

// Keep only questionnaire answers and attribution. Never store passwords, OTPs or sessions.
export const QUESTIONNAIRE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DRAFT_BYTES = 128_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface QuestionnaireDraft {
  version: 1;
  schema: string;
  savedAt: number;
  submissionKey: string;
  source: QuestionnaireSource | null;
  answers: Record<string, string>;
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function questionnaireDraftKey(pageId: string, blockId: string) {
  return `site-questionnaire:v1:${pageId}:${blockId}`;
}

export function readQuestionnaireDraft(
  storage: DraftStorage,
  key: string,
  schema: string,
  fieldCount: number,
  now = Date.now(),
): QuestionnaireDraft | null {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > MAX_DRAFT_BYTES) return null;
    const draft = JSON.parse(raw);
    if (draft.version !== 1 || draft.schema !== schema || !UUID.test(draft.submissionKey)
      || !Number.isFinite(draft.savedAt) || draft.savedAt > now
      || now - draft.savedAt > QUESTIONNAIRE_DRAFT_TTL_MS
      || !draft.answers || typeof draft.answers !== "object" || Array.isArray(draft.answers)) return null;

    const answers: Record<string, string> = {};
    for (let i = 0; i < fieldCount; i++) {
      const value = draft.answers[String(i)];
      if (typeof value === "string" && value.length <= 10_000) answers[String(i)] = value;
    }
    return {
      version: 1, schema, savedAt: draft.savedAt, submissionKey: draft.submissionKey,
      source: parseQuestionnaireSource(draft.source), answers,
    };
  } catch {
    // Disabled storage or a corrupt draft must not prevent filling the form.
    return null;
  }
}

export function saveQuestionnaireDraft(storage: DraftStorage, key: string, draft: QuestionnaireDraft): boolean {
  try {
    // Explicit projection prevents an auth object accidentally reaching localStorage.
    const serialized = JSON.stringify({
      version: 1, schema: draft.schema, savedAt: draft.savedAt,
      submissionKey: draft.submissionKey, source: parseQuestionnaireSource(draft.source),
      answers: Object.fromEntries(Object.entries(draft.answers).filter(([index, value]) =>
        /^(0|[1-9]\d{0,2})$/.test(index) && typeof value === "string" && value.length <= 10_000)),
    });
    if (serialized.length > MAX_DRAFT_BYTES) return false;
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

/** Call only after the server confirms the submission succeeded. */
export function clearQuestionnaireDraft(storage: DraftStorage, key: string): boolean {
  try { storage.removeItem(key); return true; } catch { return false; }
}
