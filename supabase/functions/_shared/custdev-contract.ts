/** Pure, shared by browser, Edge and contract tests. No network or credentials. */
export const GROUPS = [
  "Исходная ситуация",
  "Триггер",
  "Последствия проблемы",
  "Альтернативы",
  "Критерии выбора",
  "Решение о покупке",
  "Опыт после покупки",
] as const;
export const TYPES = ["active", "former", "prospect"] as const;
export const TYPE_LABELS = {
  active: "Действующий",
  former: "Бывший",
  prospect: "Потенциальный",
};
export const CATEGORIES = [
  "problem",
  "trigger",
  "desired_outcome",
  "selection_criterion",
  "concern",
] as const;
export const CATEGORY_LABELS = {
  problem: "Проблема",
  trigger: "Триггер",
  desired_outcome: "Желаемый результат",
  selection_criterion: "Критерий выбора",
  concern: "Опасение",
};
export type RespondentType = typeof TYPES[number];
export type Category = typeof CATEGORIES[number];
export type Score = number | null;
export interface Question {
  id: string;
  group: number;
  text: string;
  types: RespondentType[];
  note: string;
  order: number;
  archived?: boolean;
}
export interface Segment {
  id: string;
  title: string;
  description: string;
  decisionMaker: string;
  reason: string;
  productTypeIds: string[];
  questions: Question[];
  archived?: boolean;
}
export interface Followup {
  id: string;
  question: string;
  answer: string;
}
export interface Answer {
  id: string;
  questionId: string;
  snapshot: string;
  group: number;
  text: string;
  status: "not_asked" | "unanswered" | "received";
  followups: Followup[];
}
export interface PortfolioRef {
  lessonId: string;
  blockId: string;
  clientId: string;
}
export interface Interview {
  id: string;
  segmentId: string;
  name: string;
  type: RespondentType;
  category: string | null;
  portfolioRef: PortfolioRef | null;
  date: string;
  status: "planned" | "in_progress" | "completed";
  answers: Answer[];
  archived?: boolean;
}
export interface Quote {
  id: string;
  interviewId: string;
  questionId: string;
  sourceId: string;
  text: string;
  category: Category;
  excluded: boolean;
  manual: boolean;
  sourceVersion: string;
  rationale?: string;
  categoryOverridden?: boolean;
  historical?: boolean;
}
export interface Scores {
  significance: Score;
  purchaseImpact: Score;
  productFit: Score;
}
export interface Need {
  id: string;
  label: string;
  category: Category;
  quoteIds: string[];
  aiOriginal: (Scores & { rationale: string; productRefs?: string[] }) | null;
  overrides: Partial<Scores & { frequency: Score; rationale: string }>;
  approvedValue:
    | (Scores & { frequency: Score; rationale: string; sourceHash: string })
    | null;
  excluded: boolean;
  priority: boolean;
}
export interface Analysis {
  quotes: Quote[];
  needs: Need[];
  sourceHash: string;
  adoptedRunId: string | null;
}
export interface Wording {
  userText: string;
  aiText: string;
  approvedText: string;
  task: string;
  specialization: string;
  difference: string;
  needIds: string[];
}
export interface Usp {
  id: string;
  segmentId: string;
  title: string;
  needId: string | null;
  problem: string;
  result: string;
  mechanism: string;
  productRefs: string[];
  evidence: string;
  userText: string;
  aiText: string;
  approvedText: string;
  status: "draft" | "needs_evidence" | "ready";
}
export interface CustdevState {
  version: 1;
  segments: Segment[];
  interviews: Interview[];
  analyses: Record<string, Analysis>;
  company: Wording;
  positioning: Record<string, Wording>;
  usps: Usp[];
}
export interface SourceProduct {
  id: string;
  name: string;
  description: string;
  kind: "client_type" | "complexity" | "service" | "responsibility";
}
export interface PortfolioClient {
  id: string;
  name: string;
  category: string | null;
  ref: PortfolioRef;
}
export interface Sources {
  portfolio: PortfolioClient[];
  products: SourceProduct[];
  context: Record<string, unknown>;
  lessons: { id: string; title: string }[];
  warnings: string[];
}
export interface SourceAnswer {
  id: string;
  interviewId: string;
  questionId: string;
  question: string;
  text: string;
}
export const newId = () => crypto.randomUUID();
export const emptyWording = (): Wording => ({
  userText: "",
  aiText: "",
  approvedText: "",
  task: "",
  specialization: "",
  difference: "",
  needIds: [],
});
export const emptyAnalysis = (): Analysis => ({
  quotes: [],
  needs: [],
  sourceHash: "",
  adoptedRunId: null,
});
export const emptyState = (): CustdevState => ({
  version: 1,
  segments: [],
  interviews: [],
  analyses: {},
  company: emptyWording(),
  positioning: {},
  usps: [],
});
export const clone = <T>(v: T): T => structuredClone(v);
const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function insist(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const text = (v: unknown) => typeof v === "string" && v.length <= 30000;
const score = (v: unknown) =>
  v === null || (Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 5);
const unique = (a: unknown[]) => new Set(a).size === a.length;
const isCategory = (v: unknown): v is Category =>
  CATEGORIES.includes(v as Category);
export const refKey = (r: PortfolioRef) =>
  `${r.lessonId}:${r.blockId}:${r.clientId}`;

/** Runtime constraints also run before any persistence; empty drafts are valid. */
export function validateState(raw: unknown): asserts raw is CustdevState {
  insist(obj(raw) && raw.version === 1, "Неподдерживаемый формат задания");
  insist(
    Array.isArray(raw.segments) && Array.isArray(raw.interviews) &&
      Array.isArray(raw.usps) && obj(raw.analyses) && obj(raw.positioning),
    "Повреждена структура задания",
  );
  insist(
    JSON.stringify(raw).length <= 2_000_000,
    "Документ слишком большой; сократите необязательные материалы",
  );
  const state = raw as unknown as CustdevState, ids = new Set<string>();
  const id = (v: unknown) => {
    insist(validId(v) && !ids.has(v), "Повторяющийся или неверный ID");
    ids.add(v);
  };
  const wording = (w: unknown) => {
    insist(
      obj(w) &&
        [
          w.userText,
          w.aiText,
          w.approvedText,
          w.task,
          w.specialization,
          w.difference,
        ].every(text) && Array.isArray(w.needIds) && w.needIds.every(validId),
      "Неверное позиционирование",
    );
  };
  for (const s of state.segments) {
    insist(obj(s), "Неверный сегмент");
    id(s.id);
    insist(
      s.archived === undefined || typeof s.archived === "boolean",
      "Неверный статус сегмента",
    );
    insist(
      [s.title, s.description, s.decisionMaker, s.reason].every(text) &&
        Array.isArray(s.productTypeIds) && s.productTypeIds.every(validId) &&
        Array.isArray(s.questions),
      "Неверные поля сегмента",
    );
    for (let g = 1; g <= 7; g++) {
      insist(
        s.questions.filter((q) => !q.archived && q.group === g).length <= 10,
        "Максимум 10 вопросов в группе сегмента",
      );
    }
    for (const q of s.questions) {
      id(q.id);
      insist(
        q.archived === undefined || typeof q.archived === "boolean",
        "Неверный статус вопроса",
      );
      insist(
        Number.isInteger(q.group) && q.group >= 1 && q.group <= 7 &&
          text(q.text) && text(q.note) && Number.isInteger(q.order),
        "Неверный вопрос",
      );
      insist(
        Array.isArray(q.types) && q.types.length > 0 && unique(q.types) &&
          q.types.every((t) => TYPES.includes(t)),
        "Выберите типы респондентов",
      );
    }
  }
  const segmentIds = new Set(state.segments.map((s) => s.id)),
    imported = new Set<string>();
  for (const i of state.interviews) {
    insist(obj(i), "Неверное интервью");
    id(i.id);
    insist(
      i.archived === undefined || typeof i.archived === "boolean",
      "Неверный статус интервью",
    );
    insist(
      segmentIds.has(i.segmentId) && text(i.name) && TYPES.includes(i.type) &&
        text(i.date) &&
        ["planned", "in_progress", "completed"].includes(i.status) &&
        Array.isArray(i.answers),
      "Неверные данные интервью",
    );
    insist(i.category === null || text(i.category), "Неверная категория");
    if (i.portfolioRef !== null) {
      insist(
        obj(i.portfolioRef) &&
          [
            i.portfolioRef.lessonId,
            i.portfolioRef.blockId,
            i.portfolioRef.clientId,
          ].every(validId),
        "Неверный источник портфеля",
      );
      const key = `${i.segmentId}:${refKey(i.portfolioRef)}`;
      insist(!imported.has(key), "Клиент уже импортирован в этот сегмент");
      imported.add(key);
    } else {insist(
        i.type === "active" || i.category === null,
        "Без источника портфеля категория бывшего/потенциального клиента пустая",
      );}
    insist(
      unique(i.answers.map((a) => a.questionId)),
      "Повторный ответ на вопрос",
    );
    for (const a of i.answers) {
      id(a.id);
      insist(
        validId(a.questionId) && text(a.snapshot) && text(a.text) &&
          Number.isInteger(a.group) && a.group >= 1 && a.group <= 7 &&
          ["not_asked", "unanswered", "received"].includes(a.status) &&
          Array.isArray(a.followups),
        "Неверный ответ",
      );
      for (const f of a.followups) {
        id(f.id);
        insist(text(f.question) && text(f.answer), "Неверное уточнение");
      }
    }
  }
  for (const [sid, a] of Object.entries(state.analyses)) {
    insist(
      segmentIds.has(sid) && obj(a) && Array.isArray(a.quotes) &&
        Array.isArray(a.needs) && text(a.sourceHash),
      "Неверный анализ сегмента",
    );
    for (const q of a.quotes) {
      id(q.id);
      const i = state.interviews.find((i) => i.id === q.interviewId);
      insist(
        i && i.segmentId === sid && i.answers.some((a) =>
          a.questionId === q.questionId &&
          (a.id === q.sourceId || a.followups.some((f) =>
            f.id === q.sourceId
          ))
        ) && text(q.text) && isCategory(q.category) &&
          typeof q.excluded === "boolean" && typeof q.manual === "boolean" &&
          text(q.sourceVersion),
        "Цитата должна иметь источник в своём сегменте",
      );
    }
    const quoteIds = new Set(a.quotes.map((q) => q.id));
    for (const n of a.needs) {
      id(n.id);
      insist(
        text(n.label) && isCategory(n.category) && Array.isArray(n.quoteIds) &&
          unique(n.quoteIds) && n.quoteIds.every((q) => quoteIds.has(q)) &&
          obj(n.overrides),
        "Неверная потребность или чужая цитата",
      );
      for (const f of [n.aiOriginal, n.overrides, n.approvedValue]) {
        if (f) {
          insist(obj(f), "Неверная оценка");
          for (
            const k of [
              "significance",
              "purchaseImpact",
              "productFit",
              "frequency",
            ]
          ) {
            if (k in f) {
              insist(
                score((f as unknown as Record<string, unknown>)[k]),
                "Оценки от 1 до 5 либо не определены",
              );
            }
          }
          if ("rationale" in f) {
            insist(text(f.rationale), "Неверное обоснование");
          }
        }
      }
    }
  }
  wording(state.company);
  const allNeeds = new Set(
    Object.values(state.analyses).flatMap((a) => a.needs.map((n) => n.id)),
  );
  insist(
    state.company.needIds.every((id) => allNeeds.has(id)),
    "Неизвестная потребность компании",
  );
  for (const [sid, w] of Object.entries(state.positioning)) {
    insist(segmentIds.has(sid), "Неизвестный сегмент позиционирования");
    wording(w);
    insist(
      w.needIds.every((id) =>
        state.analyses[sid]?.needs.some((n) => n.id === id)
      ),
      "Чужая потребность позиционирования",
    );
  }
  for (const u of state.usps) {
    id(u.id);
    insist(
      segmentIds.has(u.segmentId) &&
        [
          u.title,
          u.problem,
          u.result,
          u.mechanism,
          u.evidence,
          u.userText,
          u.aiText,
          u.approvedText,
        ].every(text) && Array.isArray(u.productRefs) &&
        u.productRefs.every(validId) &&
        ["draft", "needs_evidence", "ready"].includes(u.status),
      "Неверное УТП",
    );
    insist(
      u.status !== "ready" || u.evidence.trim().length > 0,
      "УТП без доказательств — гипотеза",
    );
    insist(
      u.needId === null ||
        state.analyses[u.segmentId]?.needs.some((n) => n.id === u.needId),
      "УТП ссылается на потребность другого сегмента",
    );
  }
}

export function applicableQuestions(s: Segment, type: RespondentType) {
  return s.questions.filter((q) => !q.archived && q.types.includes(type)).sort((
    a,
    b,
  ) => a.group - b.group || a.order - b.order);
}
/** Existing answer snapshots are immutable, including after question deletion. */
export function syncInterview(i: Interview, s: Segment): Interview {
  const result = clone(i);
  for (const q of applicableQuestions(s, i.type)) {
    if (!result.answers.some((a) => a.questionId === q.id)) {
      result.answers.push({
        id: newId(),
        questionId: q.id,
        snapshot: q.text,
        group: q.group,
        text: "",
        status: "not_asked",
        followups: [],
      });
    }
  }
  return result;
}
export function sourceAnswers(
  state: CustdevState,
  sid: string,
): SourceAnswer[] {
  return state.interviews.filter((i) =>
    !i.archived && i.segmentId === sid && i.status === "completed"
  ).flatMap((i) =>
    i.answers.flatMap((a) => [
      ...(a.status === "received" && a.text.trim()
        ? [{
          id: a.id,
          interviewId: i.id,
          questionId: a.questionId,
          question: a.snapshot,
          text: a.text,
        }]
        : []),
      ...a.followups.filter((f) => f.answer.trim()).map((f) => ({
        id: f.id,
        interviewId: i.id,
        questionId: a.questionId,
        question: `${a.snapshot} / ${f.question}`,
        text: f.answer,
      })),
    ])
  );
}
export function frequency(k: number, n: number): Score {
  return n <= 0 || k <= 0 ? null : Math.min(5, Math.ceil(k * 5 / n));
}
export function needScores(state: CustdevState, sid: string, need: Need) {
  const analysis = state.analyses[sid] ?? emptyAnalysis();
  const interviews = state.interviews.filter((i) =>
    !i.archived && i.segmentId === sid && i.status === "completed"
  );
  const eligible = new Set(interviews.map((i) => i.id));
  const k = new Set(
    analysis.quotes.filter((q) =>
      !q.excluded && !q.historical && need.quoteIds.includes(q.id) &&
      eligible.has(q.interviewId)
    ).map((q) => q.interviewId),
  ).size;
  const computed = frequency(k, interviews.length);
  const get = (key: keyof Scores): Score =>
    need.overrides[key] !== undefined
      ? need.overrides[key]!
      : need.aiOriginal?.[key] ?? null;
  const values = {
    frequency: need.overrides.frequency !== undefined
      ? need.overrides.frequency
      : computed,
    significance: get("significance"),
    purchaseImpact: get("purchaseImpact"),
    productFit: get("productFit"),
  };
  const scores = Object.values(values);
  return {
    k,
    n: interviews.length,
    computedFrequency: computed,
    ...values,
    total: scores.every((v) => v !== null)
      ? scores.reduce<number>((sum, v) => sum + Number(v), 0)
      : null,
    rationale: need.overrides.rationale ?? need.aiOriginal?.rationale ?? "",
  };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (obj(value)) {
    return `{${
      Object.keys(value).sort().map((k) =>
        `${JSON.stringify(k)}:${canonical(value[k])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export const segmentHash = (
  state: CustdevState,
  sid: string,
  sources: Sources,
) =>
  digest({
    segment: state.segments.find((s) => s.id === sid),
    interviews: state.interviews.filter((i) => i.segmentId === sid),
    products: sources.products,
    context: sources.context,
  });

export function extractQuotes(raw: unknown, answers: SourceAnswer[]): Quote[] {
  insist(Array.isArray(raw), "ИИ вернул неверный формат цитат");
  return raw.map((v) => {
    insist(
      obj(v) && text(v.exact_quote) &&
        String(v.exact_quote).trim().length > 0 && isCategory(v.category) &&
        text(v.rationale),
      "Неверная цитата ИИ",
    );
    const source = answers.find((a) =>
      a.id === v.source_answer_id && a.interviewId === v.source_respondent_id
    );
    insist(
      source && source.text.includes(v.exact_quote as string),
      "Цитата не является дословным фрагментом ответа",
    );
    return {
      id: newId(),
      interviewId: source.interviewId,
      questionId: source.questionId,
      sourceId: source.id,
      text: v.exact_quote as string,
      category: v.category as Category,
      excluded: false,
      manual: false,
      sourceVersion: "",
      rationale: String(v.rationale),
    };
  });
}
export function extractNeeds(
  raw: unknown,
  quotes: Quote[],
  products: SourceProduct[],
): Need[] {
  insist(Array.isArray(raw), "ИИ вернул неверный формат потребностей");
  const used = new Set<string>();
  return raw.map((v) => {
    insist(
      obj(v) && text(v.need_label) && String(v.need_label).trim() &&
        isCategory(v.primary_category) && Array.isArray(v.quote_ids) &&
        v.quote_ids.length > 0 && unique(v.quote_ids),
      "Неверная потребность ИИ",
    );
    for (const id of v.quote_ids) {
      insist(
        quotes.some((q) => q.id === id && !q.excluded) &&
          !used.has(id as string),
        "Чужая или повторно сгруппированная цитата",
      );
      used.add(id as string);
    }
    const read = (key: string) => {
      const x = v[key];
      insist(
        obj(x) && score(x.score) && text(x.rationale),
        "Неверная оценка ИИ",
      );
      return x as {
        score: Score;
        rationale: string;
        linked_product_refs?: string[];
      };
    };
    const sig = read("significance"),
      impact = read("purchase_impact"),
      fit = read("product_fit");
    const refs = fit.linked_product_refs ?? [];
    insist(
      Array.isArray(refs) &&
        refs.every((r) => products.some((p) => p.id === r)),
      "ИИ сослался на несуществующий продукт",
    );
    return {
      id: newId(),
      label: String(v.need_label),
      category: v.primary_category as Category,
      quoteIds: v.quote_ids as string[],
      aiOriginal: {
        significance: sig.score,
        purchaseImpact: impact.score,
        productFit: products.length && refs.length ? fit.score : null,
        productRefs: refs,
        rationale: [
          sig.rationale,
          impact.rationale,
          products.length && refs.length
            ? fit.rationale
            : "Соответствие продукту требует проверки",
        ].join("\n"),
      },
      overrides: {},
      approvedValue: null,
      excluded: false,
      priority: false,
    };
  });
}

/** Preview adoption preserves all human work unless replace was explicitly confirmed. */
export function adoptQuotes(
  old: Analysis,
  fresh: Quote[],
  preserve: boolean,
): Analysis {
  const matches = new Set<string>();
  const quotes = fresh.map((q) => {
    const prior = old.quotes.find((p) =>
      p.sourceId === q.sourceId && p.text === q.text
    );
    if (!prior) return q;
    matches.add(prior.id);
    return {
      ...q,
      id: prior.id,
      ...(preserve
        ? {
          excluded: prior.excluded,
          manual: prior.manual,
          category: prior.categoryOverridden ? prior.category : q.category,
          categoryOverridden: prior.categoryOverridden,
        }
        : {}),
    };
  });
  if (preserve) quotes.push(...old.quotes.filter((q) => !matches.has(q.id)));
  return { ...old, quotes, needs: preserve ? old.needs : [] };
}
export function adoptNeeds(
  old: Analysis,
  fresh: Need[],
  preserve: boolean,
): Analysis {
  const matched = new Set<string>();
  const needs = fresh.map((n) => {
    const prior = old.needs.find((p) =>
      p.quoteIds.length === n.quoteIds.length &&
      [...p.quoteIds].sort().join() === [...n.quoteIds].sort().join()
    );
    if (!prior) return n;
    matched.add(prior.id);
    return preserve
      ? {
        ...n,
        id: prior.id,
        aiOriginal: prior.approvedValue ? prior.aiOriginal : n.aiOriginal,
        label: prior.label,
        category: prior.category,
        quoteIds: prior.quoteIds,
        overrides: prior.overrides,
        approvedValue: prior.approvedValue,
        excluded: prior.excluded,
        priority: prior.priority,
      }
      : { ...n, id: prior.id };
  });
  if (preserve) needs.push(...old.needs.filter((n) => !matched.has(n.id)));
  return { ...old, needs };
}
export function completionIssues(
  state: CustdevState,
  hashes: Record<string, string>,
): string[] {
  const active = state.segments.filter((s) => !s.archived && s.title.trim());
  if (!active.length) return ["Добавьте хотя бы один сегмент"];
  if (
    !active.some((s) =>
      state.interviews.some((i) =>
        !i.archived && i.segmentId === s.id && i.status === "completed" &&
        (i.answers.some((a) => a.status === "received" && a.text.trim()) ||
          i.answers.some((a) => a.followups.some((f) => f.answer.trim())))
      )
    )
  ) return ["Завершите хотя бы одно интервью с содержательным ответом"];
  if (!state.company.approvedText.trim()) {
    return ["Подтвердите общее позиционирование компании"];
  }
  const complete = active.some((s) => {
    const a = state.analyses[s.id];
    return a && a.sourceHash === hashes[s.id] && a.needs.some((n) =>
      !n.excluded && n.label.trim() &&
      n.approvedValue?.sourceHash === hashes[s.id] &&
      needScores(state, s.id, n).k > 0
    ) && state.positioning[s.id]?.approvedText.trim() && state.usps.some((u) =>
      u.segmentId === s.id && u.problem.trim() && u.result.trim() &&
      u.mechanism.trim() && u.approvedText.trim()
    );
  });
  return complete ? [] : [
    "Для одного сегмента утвердите актуальный анализ, позиционирование и хотя бы одно УТП",
  ];
}

/** Redact identifiers before transport. Model quotes still must match original fragments. */
export function redactForAi(s: string, names: string[] = []): string {
  let out = s.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(?:\+\d[\d\s().-]{7,}\d)/g, "[телефон]")
    .replace(/\b\d{9,16}\b/g, "[идентификатор]")
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9 ]{11,32}\b/g, "[реквизиты]")
    .replace(
      /(?:паспорт|личный номер|идентификационный номер|УНП|ИНН)\s*[:№]?\s*[A-ZА-Я0-9-]{5,}/giu,
      "[документ]",
    )
    .replace(
      /(?:ул\.|улица|проспект|пр-т|переулок)\s+[^\n,;"}]{2,100}(?:,\s*(?:д\.|дом|кв\.|квартира)\s*\d+[\w/-]*)*/giu,
      "[адрес]",
    );
  for (
    const n of [...names].filter((n) => n.trim().length >= 3).sort((a, b) =>
      b.length - a.length
    )
  ) out = out.split(n).join("[респондент]");
  return out;
}
