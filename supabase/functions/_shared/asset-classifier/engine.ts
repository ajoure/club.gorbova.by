import { ASSET_CLASSIFIER_CATALOG } from "./catalog-161.ts";

export const ASSET_CLASSIFIER_SCENARIO_CODE = "asset_classifier";
export const ASSET_CLASSIFIER_SECTION_CODE = "ai_asset_classifier";
export const ASSET_CLASSIFIER_SOURCE_URL =
  "https://etalonline.by/document/?regnum=w21124359";

const STOP_WORDS = new Set([
  "для", "или", "как", "это", "эта", "этот", "его", "ее", "при", "под", "над",
  "без", "что", "есть", "нужен", "нужна", "нужно", "определить", "подобрать",
  "основное", "средство", "ос", "шифр", "код", "срок", "службы", "лет",
  "используется", "используем", "применяется", "предприятие", "организация",
]);

const SUFFIXES = [
  "иями", "ями", "ами", "ого", "ему", "ому", "ыми", "ими", "ая", "яя", "ое",
  "ее", "ые", "ие", "ый", "ий", "ой", "ую", "юю", "ам", "ям", "ах", "ях",
  "ов", "ев", "ом", "ем", "ам", "ям", "ы", "и", "а", "я", "у", "ю", "е", "о",
];

const SYNONYMS: Record<string, string[]> = {
  ноутбук: ["компьютер", "портативный", "персональный"],
  laptop: ["ноутбук", "компьютер", "портативный"],
  компьютер: ["вычислительный", "персональный", "системный"],
  пк: ["компьютер", "персональный"],
  сервер: ["вычислительный", "сервер"],
  принтер: ["печатающий", "печати", "принтер"],
  мфу: ["многофункциональный", "копировальный", "печатающий"],
  сканер: ["сканирующий", "сканер"],
  телефон: ["телефонный", "телефон", "связи"],
  смартфон: ["телефон", "мобильный", "сотовый"],
  кондиционер: ["кондиционирования", "кондиционер", "климатический"],
  автомобиль: ["автомобиль", "легковой", "грузовой", "транспортный"],
  авто: ["автомобиль", "транспортный"],
  камера: ["видеокамера", "камера", "видеонаблюдения"],
  видеорегистратор: ["видеорегистратор", "видеозаписи"],
  мебель: ["мебель", "стол", "шкаф", "кресло"],
  стол: ["стол", "мебель"],
  кресло: ["кресло", "мебель"],
  шкаф: ["шкаф", "мебель"],
};

export interface AssetClassifierCandidate {
  code: string;
  name: string;
  normativeLifeYears: number;
  hierarchy: string[];
  footnotes: Array<{ marker: string; text: string }>;
  score: number;
  matchedTerms: string[];
  sourceRow: number;
}

export interface AssetClassifierResult {
  decision: "recommended" | "clarification" | "not_found";
  query: string;
  candidates: AssetClassifierCandidate[];
  content: string;
  metadata: {
    scenario_code: typeof ASSET_CLASSIFIER_SCENARIO_CODE;
    scenario_type: "deterministic_lookup";
    legal_source_regnum: string;
    legal_source_revision: string;
    catalog_positions: number;
    decision: AssetClassifierResult["decision"];
  };
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(value: string): string {
  if (value.length <= 4) return value;
  const suffix = SUFFIXES.find((candidate) =>
    value.endsWith(candidate) && value.length - candidate.length >= 4
  );
  return suffix ? value.slice(0, -suffix.length) : value;
}

function queryTokens(query: string): string[] {
  return Array.from(new Set(
    normalize(query)
      .split(" ")
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token) && !/^\d{1,4}$/.test(token)),
  ));
}

const footnoteByMarker = new Map(
  ASSET_CLASSIFIER_CATALOG.footnotes.map((footnote) => [footnote.marker, footnote.text]),
);

const searchableItems = ASSET_CLASSIFIER_CATALOG.items.map((item) => {
  const hierarchy = ASSET_CLASSIFIER_CATALOG.hierarchy
    .filter((node) =>
      node.sourceRow < item.sourceRow &&
      item.code.startsWith(node.code)
    )
    .sort((a, b) => a.code.length - b.code.length || b.sourceRow - a.sourceRow)
    .filter((node, index, all) =>
      all.findIndex((candidate) => candidate.code.length === node.code.length) === index
    )
    .map((node) => node.name);

  const nameNormalized = normalize(item.name);
  const hierarchyNormalized = normalize(hierarchy.join(" "));
  return {
    item,
    hierarchy,
    nameNormalized,
    nameWords: nameNormalized.split(" "),
    hierarchyNormalized,
    hierarchyWords: hierarchyNormalized.split(" "),
  };
});

function scoreItem(
  item: (typeof searchableItems)[number],
  originalTokens: string[],
): { score: number; matchedTerms: string[] } {
  let score = 0;
  const matchedTerms = new Set<string>();

  for (const original of originalTokens) {
    const expanded = Array.from(new Set([original, ...(SYNONYMS[original] ?? [])]));
    let bestForToken = 0;

    for (const term of expanded) {
      const termStem = stem(term);
      let termScore = 0;

      if (item.nameWords.includes(term)) termScore = Math.max(termScore, 14);
      if (item.nameWords.some((word) => stem(word) === termStem)) termScore = Math.max(termScore, 11);
      if (term.length >= 4 && item.nameNormalized.includes(term)) termScore = Math.max(termScore, 8);
      if (item.hierarchyWords.includes(term)) termScore = Math.max(termScore, 5);
      if (item.hierarchyWords.some((word) => stem(word) === termStem)) termScore = Math.max(termScore, 4);
      if (term.length >= 4 && item.hierarchyNormalized.includes(term)) termScore = Math.max(termScore, 3);

      bestForToken = Math.max(bestForToken, termScore);
    }

    if (bestForToken > 0) {
      score += bestForToken;
      matchedTerms.add(original);
    }
  }

  return { score, matchedTerms: [...matchedTerms] };
}

function toCandidate(
  source: (typeof searchableItems)[number],
  score: number,
  matchedTerms: string[],
): AssetClassifierCandidate {
  return {
    code: source.item.code,
    name: source.item.name,
    normativeLifeYears: source.item.normativeLifeYears,
    hierarchy: source.hierarchy,
    footnotes: source.item.footnoteMarkers.flatMap((marker) => {
      const text = footnoteByMarker.get(marker);
      return text ? [{ marker, text }] : [];
    }),
    score,
    matchedTerms,
    sourceRow: source.item.sourceRow,
  };
}

function renderCandidate(candidate: AssetClassifierCandidate, position: number): string {
  const context = candidate.hierarchy.length > 0
    ? `\n   Раздел: ${candidate.hierarchy.join(" → ")}.`
    : "";
  return `${position}. **${candidate.code} — ${candidate.name}**\n` +
    `   Нормативный срок службы: **${candidate.normativeLifeYears} лет**.${context}`;
}

function renderResult(
  query: string,
  decision: AssetClassifierResult["decision"],
  candidates: AssetClassifierCandidate[],
): string {
  const sourceLine =
    `Источник: [постановление Министерства экономики Республики Беларусь от 30.09.2011 № 161](${ASSET_CLASSIFIER_SOURCE_URL}), ` +
    "консолидированная редакция с изменениями по 10.04.2017.";

  if (decision === "not_found") {
    return [
      "### Нужно уточнить описание объекта",
      "",
      "В справочнике не найдено достаточно близкой позиции. Укажите:",
      "",
      "- точное наименование и модель;",
      "- основное назначение;",
      "- ключевые технические характеристики;",
      "- сферу и условия эксплуатации.",
      "",
      sourceLine,
      "",
      "_Результат сервиса носит справочный характер. Перед принятием к учёту сопоставьте объект с технической документацией и действующей редакцией законодательства._",
    ].join("\n");
  }

  const primary = candidates[0];
  const heading = decision === "recommended"
    ? "### Предварительно рекомендуемый шифр"
    : "### Возможные позиции — требуется уточнение";
  const primaryBlock = decision === "recommended"
    ? [
        `**${primary.code} — ${primary.name}**`,
        "",
        `Нормативный срок службы: **${primary.normativeLifeYears} лет**.`,
        primary.hierarchy.length > 0 ? `Раздел: ${primary.hierarchy.join(" → ")}.` : "",
      ].filter(Boolean)
    : [
        "По введённому описанию нельзя безопасно выбрать единственный шифр.",
        "",
        ...candidates.map(renderCandidate),
      ];

  const footnotes = primary?.footnotes.length
    ? [
        "",
        "**Примечания к позиции:**",
        ...primary.footnotes.map((footnote) => `- Сноска ${footnote.marker}: ${footnote.text}`),
      ]
    : [];

  const alternatives = decision === "recommended" && candidates.length > 1
    ? [
        "",
        "**Ближайшие альтернативы:**",
        ...candidates.slice(1).map(renderCandidate),
      ]
    : [];

  return [
    heading,
    "",
    ...primaryBlock,
    ...footnotes,
    ...alternatives,
    "",
    `Запрос: “${query.trim()}”.`,
    "",
    decision === "recommended"
      ? "Проверьте, совпадают ли назначение и характеристики объекта с формулировкой позиции. Если нет — дополните описание и выполните подбор повторно."
      : "Добавьте модель, назначение и ключевые характеристики объекта — сервис повторит подбор.",
    "",
    sourceLine,
    "",
    "_Результат сервиса носит справочный характер. Перед принятием к учёту сопоставьте объект с технической документацией и действующей редакцией законодательства._",
  ].join("\n");
}

export function classifyAsset(query: string): AssetClassifierResult {
  const normalizedQuery = normalize(query);
  const explicitCode = normalizedQuery.match(/(?:^|\s)(\d{5})(?:\s|$)/)?.[1];
  const originalTokens = queryTokens(query);

  const ranked = searchableItems
    .map((source) => {
      if (explicitCode && source.item.code === explicitCode) {
        return toCandidate(source, 1000, [explicitCode]);
      }
      const score = scoreItem(source, originalTokens);
      return toCandidate(source, score.score, score.matchedTerms);
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      b.matchedTerms.length - a.matchedTerms.length ||
      a.code.localeCompare(b.code)
    )
    .slice(0, 3);

  const top = ranked[0];
  const second = ranked[1];
  const coverage = top && originalTokens.length > 0
    ? top.matchedTerms.length / originalTokens.length
    : 0;
  const margin = top ? top.score - (second?.score ?? 0) : 0;

  let decision: AssetClassifierResult["decision"] = "not_found";
  if (top) {
    if (explicitCode && top.code === explicitCode) {
      decision = "recommended";
    } else if (top.score >= 18 && coverage >= 0.5 && margin >= 3) {
      decision = "recommended";
    } else {
      decision = "clarification";
    }
  }

  return {
    decision,
    query,
    candidates: ranked,
    content: renderResult(query, decision, ranked),
    metadata: {
      scenario_code: ASSET_CLASSIFIER_SCENARIO_CODE,
      scenario_type: "deterministic_lookup",
      legal_source_regnum: ASSET_CLASSIFIER_CATALOG.source.regnum,
      legal_source_revision: ASSET_CLASSIFIER_CATALOG.source.consolidated_revision,
      catalog_positions: ASSET_CLASSIFIER_CATALOG.stats.finalPositions,
      decision,
    },
  };
}
