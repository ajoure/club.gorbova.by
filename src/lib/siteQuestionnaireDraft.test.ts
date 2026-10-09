import { describe, expect, it } from "vitest";
import { QUESTIONNAIRE_DRAFT_TTL_MS, readQuestionnaireDraft, saveQuestionnaireDraft, questionnaireDraftKey } from "./siteQuestionnaireDraft";
import { parseQuestionnaireSource, questionnaireSourceLinks, questionnaireSourceMetadata } from "../../supabase/functions/site-form-submit/questionnaire-source";

function storage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
}
const draft = {
  version: 1 as const, schema: "form-schema", savedAt: 1000,
  submissionKey: "5e189f24-5a17-416d-b8b5-c91eca260a92", source: "stories" as const,
  answers: { "0": "Тестовый ответ", "1": "Комментарий" },
};

describe("questionnaire draft and attribution", () => {
  it("restores answers, the same retry key and original source after reload", () => {
    const s = storage();
    expect(saveQuestionnaireDraft(s, "key", draft)).toBe(true);
    expect(readQuestionnaireDraft(s, "key", draft.schema, 2, 1001)).toEqual(draft);
    expect(questionnaireDraftKey("page", "block")).not.toBe(questionnaireDraftKey("page", "other"));
  });
  it("does not restore expired answers or answers from a changed form", () => {
    const s = storage(); saveQuestionnaireDraft(s, "key", draft);
    expect(readQuestionnaireDraft(s, "key", draft.schema, 2, draft.savedAt + QUESTIONNAIRE_DRAFT_TTL_MS + 1)).toBeNull();
    expect(readQuestionnaireDraft(s, "key", "new-schema", 2, 1001)).toBeNull();
  });
  it("ignores extra fields and never persists an auth/session object", () => {
    const s = storage();
    saveQuestionnaireDraft(s, "key", { ...draft, password: "do-not-store", session: { token: "do-not-store" } } as typeof draft);
    expect(s.getItem("key")).not.toContain("do-not-store");
    s.setItem("key", JSON.stringify({ ...draft, answers: { ...draft.answers, password: "secret", "100": "other-field" } }));
    expect(readQuestionnaireDraft(s, "key", draft.schema, 2, 1001)?.answers).toEqual(draft.answers);
  });
  it("storage restrictions or corrupt JSON do not break the form", () => {
    const denied = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => {} };
    expect(readQuestionnaireDraft(denied, "key", draft.schema, 2)).toBeNull();
    expect(saveQuestionnaireDraft(denied, "key", draft)).toBe(false);
    const s = storage(); s.setItem("key", "{");
    expect(readQuestionnaireDraft(s, "key", draft.schema, 2)).toBeNull();
  });
  it("creates ten different labelled URLs for the same page and accepts no arbitrary source", () => {
    const links = questionnaireSourceLinks("https://gorbova.by/predzapiscb21anketa");
    expect(links).toHaveLength(10);
    expect(new Set(links.map(l => l.url)).size).toBe(10);
    for (const link of links) {
      const url = new URL(link.url);
      expect(url.pathname).toBe("/predzapiscb21anketa");
      expect(questionnaireSourceMetadata(url.searchParams.get("src"))?.source_label).toBe(link.label);
    }
    expect(parseQuestionnaireSource("__proto__")).toBeNull();
    expect(questionnaireSourceMetadata("customer@example.com")).toBeNull();
  });
});
