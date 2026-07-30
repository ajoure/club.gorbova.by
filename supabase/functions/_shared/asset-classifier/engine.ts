import { ASSET_CLASSIFIER_CATALOG } from "./catalog-161.ts";
import {
  identifyObjectLocally,
  type IdentifiedAssetObject,
  type IdentificationConfidence,
} from "./object-identifier.ts";

export const ASSET_CLASSIFIER_SCENARIO_CODE = "asset_classifier";
export const ASSET_CLASSIFIER_SECTION_CODE = "ai_asset_classifier";
export const ASSET_CLASSIFIER_SCENARIO_TYPE = "asset_classifier_hybrid";
export const ASSET_CLASSIFIER_SOURCE_SLUG =
  "postanovlenie-minekonomiki-161-2011";
export const ASSET_CLASSIFIER_SOURCE_URL =
  `https://club.gorbova.by/knowledge/laws/${ASSET_CLASSIFIER_SOURCE_SLUG}`;

const STOP_WORDS = new Set([
  "для", "или", "как", "это", "эта", "этот", "его", "ее", "при", "под", "над",
  "без", "что", "есть", "нужен", "нужна", "нужно", "определить", "подобрать",
  "основное", "средство", "ос", "шифр", "код", "срок", "службы", "лет",
  "используется", "используем", "применяется", "предприятие", "организация",
]);

const GENERIC_WORDS = new Set([
  "оборудование", "устройство", "система", "аппарат", "машина", "комплекс",
  "средство", "техника", "прибор", "прочее", "общий", "применение",
]);

const NON_DISCRIMINATING_STEMS = new Set([
  "автомат",
  "автоматическ",
  "полуавтомат",
  "полуавтоматическ",
  "стационарн",
  "электрическ",
  "электронн",
  "офисн",
]);

const SUFFIXES = [
  "иями", "ями", "ами", "ого", "ему", "ому", "ыми", "ими", "ая", "яя", "ое",
  "ее", "ые", "ие", "ый", "ий", "ой", "ую", "юю", "ам", "ям", "ах", "ях",
  "ов", "ев", "ом", "ем", "ы", "и", "а", "я", "у", "ю", "е", "о",
];

export type CandidateDecision = "recommended" | "possible" | "weak";
export type CandidateMatchType = "explicit_code" | "verified_object_rule" | "catalog_text";

export interface AssetClassifierCandidate {
  code: string;
  name: string;
  normativeLifeYears: number;
  hierarchy: string[];
  footnotes: Array<{ marker: string; text: string }>;
  score: number;
  matchedTerms: string[];
  sourceRow: number;
  decision: CandidateDecision;
  matchType: CandidateMatchType;
  argumentsFor: string[];
  argumentsAgainst: string[];
}

export interface AssetClassifierResult {
  decision: "recommended" | "clarification" | "not_found";
  confidence: IdentificationConfidence;
  query: string;
  identifiedObject: IdentifiedAssetObject;
  candidates: AssetClassifierCandidate[];
  clarifyingQuestions: string[];
  guidance: string | null;
  content: string;
  metadata: {
    scenario_code: typeof ASSET_CLASSIFIER_SCENARIO_CODE;
    scenario_type: typeof ASSET_CLASSIFIER_SCENARIO_TYPE;
    legal_source_regnum: string;
    legal_source_revision: string;
    legal_source_slug: string;
    legal_source_url: string;
    catalog_positions: number;
    decision: AssetClassifierResult["decision"];
    confidence: IdentificationConfidence;
  };
}

interface VerifiedObjectRule {
  id: string;
  matcher: RegExp;
  preferredCodes: string[];
  reason: string;
  clarifyingQuestions?: string[];
  forceClarification?: boolean;
  guidance?: string;
}

const VERIFIED_OBJECT_RULES: VerifiedObjectRule[] = [
  {
    id: "mobile_phone",
    matcher: /(телефон сотов|сотовый телефон|мобильный телефон|смартфон|iphone|айфон)/i,
    preferredCodes: ["70034"],
    reason: "Объект распознан как конечное сотовое телефонное устройство.",
  },
  {
    id: "landline_phone",
    matcher: /(аппарат телефонный общего применения|телефонный аппарат|стационарный телефон|проводной телефон|радиотелефон)/i,
    preferredCodes: ["70040"],
    reason: "Объект распознан как телефонный аппарат общего применения, а не сотовый телефон.",
  },
  {
    id: "laptop",
    matcher: /(ноутбук|лэптоп|laptop|macbook|портативный персональный компьютер)/i,
    preferredCodes: ["48009"],
    reason: "Объект распознан как портативный персональный компьютер.",
  },
  {
    id: "tablet",
    matcher: /(планшетный компьютер|планшет|ipad)/i,
    preferredCodes: ["48016"],
    reason: "Объект распознан как самостоятельный планшетный компьютер.",
  },
  {
    id: "server",
    matcher: /(сервер центра обработки данных|серверный программно технический комплекс|комплексы серверов|серверный кластер|дисковый массив)/i,
    preferredCodes: ["48012"],
    reason: "Объект распознан как серверный или программно-технический комплекс.",
  },
  {
    id: "computer_peripheral",
    matcher: /(периферийное устройство|принтер|мфу|многофункциональное устройство|сканер|плоттер|монитор|источник бесперебойного питания|ибп)/i,
    preferredCodes: ["48003"],
    reason: "Объект распознан как периферийное устройство вычислительного комплекса.",
  },
  {
    id: "card_reader",
    matcher: /(считыватель.*(идентификацион|смарт|rfid|карт)|ридер.*(смарт|rfid|карт))/i,
    preferredCodes: ["48003", "45626"],
    reason: "Считыватель может быть компьютерной периферией или элементом системы контроля доступа.",
    clarifyingQuestions: [
      "Это самостоятельный USB-считыватель/периферия компьютера или элемент системы контроля и управления доступом?",
    ],
    forceClarification: true,
  },
  {
    id: "fax",
    matcher: /(аппарат факсимильный|факсимильный аппарат|факс)/i,
    preferredCodes: ["70033"],
    reason: "Объект распознан как факсимильный аппарат.",
  },
  {
    id: "household_air_conditioner",
    matcher: /(кондиционер бытовой|бытовой кондиционер|офисный кондиционер|домашний кондиционер|сплит система)/i,
    preferredCodes: ["70041"],
    reason: "Объект распознан как бытовой кондиционер помещения.",
  },
  {
    id: "refrigeration",
    matcher: /(холодильное оборудование|холодильник|морозильник|морозильная камера)/i,
    preferredCodes: ["70102", "45800"],
    reason: "В классификаторе отдельно предусмотрены бытовое и промышленное холодильное оборудование.",
    clarifyingQuestions: ["Это бытовой холодильник/морозильник или промышленное холодильное оборудование?"],
    forceClarification: true,
  },
  {
    id: "laptop_battery",
    matcher: /(аккумулятор|батарея).*(ноутбук|лэптоп|планшет|портативн)|(ноутбук|лэптоп|планшет|портативн).*(аккумулятор|батарея)/i,
    preferredCodes: ["70043"],
    reason: "Объект распознан как аккумулятор для портативной вычислительной техники.",
  },
  {
    id: "ups_battery",
    matcher: /(аккумулятор|батарея).*(ибп|источник бесперебойного питания)|(ибп|источник бесперебойного питания).*(аккумулятор|батарея)/i,
    preferredCodes: ["70042"],
    reason: "Объект распознан как аккумулятор для источника бесперебойного питания.",
  },
  {
    id: "microwave_vacuum",
    matcher: /(микроволновая печь|микроволновка|пылесос)/i,
    preferredCodes: ["70100"],
    reason: "Для объекта есть прямая бытовая позиция классификатора.",
  },
  {
    id: "dishwasher_washer",
    matcher: /(посудомоечная машина|стиральная машина)/i,
    preferredCodes: ["70101"],
    reason: "Для объекта есть прямая бытовая позиция классификатора.",
  },
  {
    id: "coffee_machine",
    matcher: /(кофе[\s-]*машин|кофемашин|кофейн[а-яё]*\s+машин|кофевар|кофе[\s-]*аппарат|кофейн.*автомат|вендинг.*коф|коф.*вендинг|эспрессо[\s-]*машин|espresso)/i,
    preferredCodes: ["45804"],
    reason:
      "Объект распознан как кофемашина или кофе-аппарат, прямо названный в позиции 45804.",
  },
  {
    id: "video_equipment",
    matcher: /(видеокамера|видеомагнитофон|dvd плеер|dvd рекордер|телевизор|видеорегистратор)/i,
    preferredCodes: ["70105"],
    reason: "Для объекта есть прямая позиция видеооборудования классификатора.",
  },
  {
    id: "photo_camera",
    matcher: /(фотоаппарат|фотокамера)/i,
    preferredCodes: ["70106"],
    reason: "Объект распознан как фотоаппарат.",
  },
  {
    id: "network_equipment",
    matcher: /(маршрутизатор|роутер|сетевой коммутатор|коммутатор сети передачи данных)/i,
    preferredCodes: ["48015", "48013"],
    reason: "Для сетевого оборудования код зависит от производственного или малого офисного исполнения.",
    clarifyingQuestions: ["Оборудование предназначено для малого офиса или производственной сети передачи данных?"],
    forceClarification: true,
  },
  {
    id: "automotive_tire",
    matcher: /(автомобильная шина|сменная автомобильная шина|шина автомобильная|автомобильная покрышка)/i,
    preferredCodes: [],
    reason: "Объект распознан как сменная часть транспортного средства.",
    clarifyingQuestions: [
      "Если требуется классификация в составе основного объекта, укажите вид транспортного средства.",
    ],
    guidance:
      "В перечне постановления № 161 отдельная позиция «автомобильные шины» не обнаружена. " +
      "Сезонность, индекс нагрузки, индекс скорости, диаметр и профиль шины не меняют подбор шифра, " +
      "поскольку эти параметры не разграничивают позиции нормативного каталога.",
  },
];

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

function tokenize(value: string): string[] {
  return Array.from(new Set(
    normalize(value)
      .split(" ")
      .filter((token) =>
        token.length >= 3 &&
        !STOP_WORDS.has(token) &&
        !GENERIC_WORDS.has(token) &&
        !GENERIC_WORDS.has(stem(token)) &&
        !NON_DISCRIMINATING_STEMS.has(stem(token)) &&
        !/^\d{1,4}$/.test(token)
      ),
  ));
}

function semanticText(query: string, object: IdentifiedAssetObject): string {
  return normalize([
    query,
    object.normalizedName,
    object.objectType,
    ...object.possibleSubtypes,
    object.primaryFunction,
    ...object.searchPhrases,
    ...object.positiveMarkers,
  ].join(" "));
}

const footnoteByMarker = new Map(
  ASSET_CLASSIFIER_CATALOG.footnotes.map((footnote) => [footnote.marker, footnote.text]),
);

const searchableItems = ASSET_CLASSIFIER_CATALOG.items.map((item) => {
  const hierarchy = ASSET_CLASSIFIER_CATALOG.hierarchy
    .filter((node) => node.sourceRow < item.sourceRow && item.code.startsWith(node.code))
    .sort((a, b) => a.code.length - b.code.length || b.sourceRow - a.sourceRow)
    .filter((node, index, all) =>
      all.findIndex((candidate) => candidate.code.length === node.code.length) === index
    )
    .map((node) => node.name);

  return {
    item,
    hierarchy,
    nameNormalized: normalize(item.name),
    nameTokens: tokenize(item.name),
    hierarchyNormalized: normalize(hierarchy.join(" ")),
  };
});

const searchableByCode = new Map(searchableItems.map((source) => [source.item.code, source]));

function toCandidate(
  code: string,
  options: {
    score: number;
    matchedTerms: string[];
    decision: CandidateDecision;
    matchType: CandidateMatchType;
    argumentsFor: string[];
    argumentsAgainst?: string[];
  },
): AssetClassifierCandidate | null {
  const source = searchableByCode.get(code);
  if (!source) return null;
  return {
    code: source.item.code,
    name: source.item.name,
    normativeLifeYears: source.item.normativeLifeYears,
    hierarchy: source.hierarchy,
    footnotes: source.item.footnoteMarkers.flatMap((marker) => {
      const text = footnoteByMarker.get(marker);
      return text ? [{ marker, text }] : [];
    }),
    score: options.score,
    matchedTerms: options.matchedTerms,
    sourceRow: source.item.sourceRow,
    decision: options.decision,
    matchType: options.matchType,
    argumentsFor: options.argumentsFor,
    argumentsAgainst: options.argumentsAgainst ?? [],
  };
}

function findCatalogCandidates(
  query: string,
  object: IdentifiedAssetObject,
  semantic: string,
): AssetClassifierCandidate[] {
  const phrases = Array.from(new Set([
    object.normalizedName,
    object.objectType,
    ...object.searchPhrases,
  ].map(normalize).filter((value) => value.length >= 4)));
  const tokens = tokenize(semantic);
  const coreTokens = new Set(tokenize([
    query,
    object.normalizedName,
    object.objectType,
    ...object.possibleSubtypes,
  ].join(" ")));
  const negativeMarkers = object.negativeMarkers.map(normalize).filter(Boolean);

  return searchableItems
    .map((source) => {
      let score = 0;
      const matchedTerms = new Set<string>();
      const argumentsFor: string[] = [];
      const argumentsAgainst: string[] = [];

      for (const phrase of phrases) {
        if (source.nameNormalized === phrase) {
          score += 80;
          matchedTerms.add(phrase);
          argumentsFor.push(`точное совпадение с формулировкой «${phrase}»`);
        } else if (phrase.length >= 6 && source.nameNormalized.includes(phrase)) {
          score += 35;
          matchedTerms.add(phrase);
          argumentsFor.push(`прямая фраза в наименовании позиции: «${phrase}»`);
        }
      }

      for (const token of tokens) {
        const tokenStem = stem(token);
        const inName = source.nameTokens.some((word) => stem(word) === tokenStem);
        if (inName) {
          score += 6;
          matchedTerms.add(token);
        } else if (source.hierarchyNormalized.includes(token)) {
          score += 1;
        }
      }

      for (const marker of negativeMarkers) {
        if (marker.length >= 5 && source.nameNormalized.includes(marker)) {
          score -= 100;
          argumentsAgainst.push(`позиция содержит несовместимый признак «${marker}»`);
        }
      }

      if (matchedTerms.size > 0 && argumentsFor.length === 0) {
        argumentsFor.push(`совпали признаки: ${[...matchedTerms].slice(0, 5).join(", ")}`);
      }

      const hasDirectPhraseMatch = argumentsFor.some((argument) =>
        argument.startsWith("точное совпадение") ||
        argument.startsWith("прямая фраза")
      );
      const hasCoreObjectMatch = [...matchedTerms].some((term) =>
        coreTokens.has(term)
      );
      if (!hasDirectPhraseMatch && !hasCoreObjectMatch) return null;

      const candidate = toCandidate(source.item.code, {
        score,
        matchedTerms: [...matchedTerms],
        decision: score >= 40 ? "possible" : "weak",
        matchType: "catalog_text",
        argumentsFor,
        argumentsAgainst,
      });
      return candidate;
    })
    .filter((candidate): candidate is AssetClassifierCandidate =>
      Boolean(candidate && candidate.score >= 18 && candidate.matchedTerms.length > 0)
    )
    .sort((a, b) =>
      b.score - a.score ||
      b.matchedTerms.length - a.matchedTerms.length ||
      a.code.localeCompare(b.code)
    )
    .slice(0, 5);
}

function yearWord(years: number): string {
  const mod100 = years % 100;
  const mod10 = years % 10;
  if (mod100 >= 11 && mod100 <= 14) return "лет";
  if (mod10 === 1) return "год";
  if (mod10 >= 2 && mod10 <= 4) return "года";
  return "лет";
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]<>]/g, "\\$&");
}

function renderCandidate(candidate: AssetClassifierCandidate, position?: number): string {
  const prefix = position ? `${position}. ` : "";
  const provisionUrl = `${ASSET_CLASSIFIER_SOURCE_URL}#code-${candidate.code}`;
  const pros = candidate.argumentsFor.length
    ? `\n   Подходит: ${candidate.argumentsFor.join("; ")}.`
    : "";
  const cons = candidate.argumentsAgainst.length
    ? `\n   Ограничение: ${candidate.argumentsAgainst.join("; ")}.`
    : "";
  return `${prefix}**[${candidate.code} — ${candidate.name}](${provisionUrl})**\n` +
    `   Нормативный срок службы: **${candidate.normativeLifeYears} ${yearWord(candidate.normativeLifeYears)}**.` +
    pros + cons;
}

function buildClarifyingQuestions(
  object: IdentifiedAssetObject,
  rule?: VerifiedObjectRule,
  candidateCount = 0,
): string[] {
  if (rule?.clarifyingQuestions?.length) {
    return Array.from(new Set(rule.clarifyingQuestions)).slice(0, 5);
  }
  if (
    candidateCount === 0 &&
    object.catalogScope !== "potential_fixed_asset" &&
    object.catalogScope !== "unknown"
  ) return [];

  const irrelevantProductSpecification =
    /(сезон|индекс.*(нагруз|скорост)|скорост.*индекс|ширин.*профил|высот.*профил|диаметр|размер|мощност|цвет)/i;
  const classificationRelevantCharacteristic =
    /(наименован|назначени|самостоятель|состав|комплектующ|родительск|исполнени|подключен|система.*использован|место.*использован|контекст|материал|вид.*оборудован|тип.*объект|какой.*(напиток|продукт)|вид.*(напитк|продукт))/i;

  const questions: string[] = [];
  for (const characteristic of object.missingCharacteristics) {
    if (
      irrelevantProductSpecification.test(characteristic) ||
      !classificationRelevantCharacteristic.test(characteristic)
    ) continue;
    questions.push(`Уточните: ${escapeMarkdown(characteristic)}?`);
  }
  return Array.from(new Set(questions)).slice(0, 5);
}

function renderResult(
  result: Omit<AssetClassifierResult, "content" | "metadata">,
): string {
  const {
    identifiedObject: object,
    decision,
    confidence,
    candidates,
    clarifyingQuestions,
    guidance,
  } = result;
  const sourceLinks = candidates.map((candidate) =>
    `[позиция ${candidate.code}](${ASSET_CLASSIFIER_SOURCE_URL}#code-${candidate.code})`
  );
  const sourceLine = sourceLinks.length
    ? `Источник: ${sourceLinks.join(", ")} внутренней базы законодательства — ` +
      "постановление Министерства экономики Республики Беларусь от 30.09.2011 № 161, " +
      "консолидированная редакция с изменениями по 10.04.2017."
    : `Источник: [постановление Министерства экономики Республики Беларусь от 30.09.2011 № 161](${ASSET_CLASSIFIER_SOURCE_URL}) ` +
      "во внутренней базе законодательства, консолидированная редакция с изменениями по 10.04.2017.";
  const confidenceLabel = confidence === "high"
    ? "высокая"
    : confidence === "medium"
    ? "средняя"
    : "низкая";

  const lines = [
    "### Что определено",
    "",
    `**Тип объекта:** ${escapeMarkdown(object.objectType)}.`,
    object.primaryFunction
      ? `**Основная функция:** ${escapeMarkdown(object.primaryFunction)}.`
      : "",
    `**Уверенность распознавания:** ${confidenceLabel}.`,
  ].filter(Boolean);

  if (object.isProbableComponent) {
    lines.push(
      "",
      "**Проверка самостоятельности:** описание похоже на комплектующую или запасную часть. " +
        "Наличие отдельного шифра не означает автоматического признания самостоятельным основным средством.",
    );
  }

  if (decision === "recommended" && candidates[0]) {
    lines.push(
      "",
      "### Предварительно рекомендуемый шифр",
      "",
      renderCandidate(candidates[0]),
    );
    if (candidates[0].hierarchy.length) {
      lines.push(`Раздел: ${candidates[0].hierarchy.join(" → ")}.`);
    }
    if (candidates[0].footnotes.length) {
      lines.push(
        "",
        "**Примечания к позиции:**",
        ...candidates[0].footnotes.map((footnote) => `- Сноска ${footnote.marker}: ${footnote.text}`),
      );
    }
    if (candidates.length > 1) {
      lines.push(
        "",
        "**Обоснованные альтернативы:**",
        ...candidates.slice(1).map((candidate, index) => renderCandidate(candidate, index + 1)),
      );
    }
  } else if (candidates.length) {
    lines.push(
      "",
      "### Возможные позиции — требуется уточнение",
      "",
      "По описанию нельзя безопасно выбрать единственный шифр:",
      "",
      ...candidates.map((candidate, index) => renderCandidate(candidate, index + 1)),
    );
  } else if (object.catalogScope === "consumable_or_inventory") {
    lines.push(
      "",
      "### По описанию это не самостоятельный долговечный объект",
      "",
      "Запрос похож на потребляемый товар, сырьё, материал или запас. " +
        "Сервис не нашёл оснований подбирать для него случайную позицию из перечня основных средств.",
    );
  } else if (object.catalogScope === "service_or_intangible") {
    lines.push(
      "",
      "### Запрос не относится к материальному объекту каталога",
      "",
      "Описание похоже на услугу, работу или нематериальный объект. " +
        "Шифр из перечня основных средств по такому описанию не подбирается.",
    );
  } else if (object.catalogScope === "not_an_object") {
    lines.push(
      "",
      "### Сначала выберите задачу помощника",
      "",
      "Запрос не содержит описания объекта. Для обычного вопроса используйте свободный чат, " +
        "а «Определение шифра ОС» запускайте отдельно через меню возможностей помощника.",
    );
  } else {
    lines.push(
      "",
      "### Недостаточно данных для подбора",
      "",
      "Сервис не нашёл обоснованной позиции и не будет подставлять случайный шифр.",
    );
  }

  if (guidance) {
    lines.push(
      "",
      "**Что действительно влияет на классификацию:**",
      guidance,
    );
  }

  if (clarifyingQuestions.length) {
    lines.push(
      "",
      "**Что нужно уточнить:**",
      ...clarifyingQuestions.map((question) => `- ${question}`),
    );
  }

  lines.push(
    "",
    sourceLine,
    "",
    "_ИИ используется только для распознавания типа и признаков объекта. " +
      "Шифр, нормативное наименование и срок берутся из фиксированного каталога постановления № 161._",
    "",
    "_Результат носит справочный характер. Перед принятием к учёту сопоставьте объект с технической документацией и действующей редакцией законодательства._",
  );
  return lines.join("\n");
}

export function classifyAsset(
  query: string,
  identifiedObject: IdentifiedAssetObject = identifyObjectLocally(query),
): AssetClassifierResult {
  const normalizedQuery = normalize(query);
  const explicitCode = normalizedQuery.match(/(?:^|\s)(\d{5})(?:\s|$)/)?.[1];
  const semantic = semanticText(query, identifiedObject);
  const outsideCatalogScope =
    identifiedObject.catalogScope === "consumable_or_inventory" ||
    identifiedObject.catalogScope === "service_or_intangible" ||
    identifiedObject.catalogScope === "not_an_object";

  let rule: VerifiedObjectRule | undefined;
  let candidates: AssetClassifierCandidate[] = [];

  if (explicitCode) {
    const exact = toCandidate(explicitCode, {
      score: 1_000,
      matchedTerms: [explicitCode],
      decision: "recommended",
      matchType: "explicit_code",
      argumentsFor: ["пользователь указал точный пятизначный шифр"],
    });
    if (exact) candidates = [exact];
  }

  if (!candidates.length && !outsideCatalogScope) {
    const matchingRules = VERIFIED_OBJECT_RULES.filter((candidate) =>
      candidate.matcher.test(semantic)
    );
    const matchedRule = /(аккумулятор|батарея)/i.test(semantic)
      ? matchingRules.find((candidate) => candidate.id.endsWith("_battery")) ?? matchingRules[0]
      : matchingRules[0];
    const componentCompatibleRuleIds = new Set([
      "laptop_battery",
      "ups_battery",
      "card_reader",
      "automotive_tire",
    ]);
    rule =
      identifiedObject.catalogScope !== "component_or_spare_part" ||
        (matchedRule && componentCompatibleRuleIds.has(matchedRule.id))
        ? matchedRule
        : undefined;
    if (rule) {
      candidates = rule.preferredCodes.flatMap((code, index) => {
        const candidate = toCandidate(code, {
          score: 900 - index * 10,
          matchedTerms: [rule!.id],
          decision: index === 0 && !rule!.forceClarification ? "recommended" : "possible",
          matchType: "verified_object_rule",
          argumentsFor: [rule!.reason],
          argumentsAgainst: rule!.forceClarification
            ? ["для выбора между позициями не хватает характеристики исполнения или назначения"]
            : [],
        });
        return candidate ? [candidate] : [];
      });
    } else if (identifiedObject.catalogScope !== "component_or_spare_part") {
      candidates = findCatalogCandidates(query, identifiedObject, semantic);
    }
  }

  const clarifyingQuestions = buildClarifyingQuestions(
    identifiedObject,
    rule,
    candidates.length,
  );
  let decision: AssetClassifierResult["decision"] = "not_found";
  let confidence: IdentificationConfidence = identifiedObject.confidence;

  if (explicitCode && candidates[0]?.code === explicitCode) {
    decision = "recommended";
    confidence = "high";
  } else if (
    rule &&
    !rule.forceClarification &&
    candidates.length === 1 &&
    identifiedObject.confidence !== "low" &&
    !identifiedObject.isProbableComponent
  ) {
    decision = "recommended";
  } else if (candidates.length > 0) {
    decision = "clarification";
    if (confidence === "high") confidence = "medium";
  }

  if (decision === "recommended") {
    candidates[0].decision = "recommended";
  }

  const baseResult = {
    decision,
    confidence,
    query,
    identifiedObject,
    candidates,
    clarifyingQuestions: decision === "recommended" ? [] : clarifyingQuestions,
    guidance: rule?.guidance ?? null,
  };

  return {
    ...baseResult,
    content: renderResult(baseResult),
    metadata: {
      scenario_code: ASSET_CLASSIFIER_SCENARIO_CODE,
      scenario_type: ASSET_CLASSIFIER_SCENARIO_TYPE,
      legal_source_regnum: ASSET_CLASSIFIER_CATALOG.source.regnum,
      legal_source_revision: ASSET_CLASSIFIER_CATALOG.source.consolidated_revision,
      legal_source_slug: ASSET_CLASSIFIER_SOURCE_SLUG,
      legal_source_url: ASSET_CLASSIFIER_SOURCE_URL,
      catalog_positions: ASSET_CLASSIFIER_CATALOG.stats.finalPositions,
      decision,
      confidence,
    },
  };
}
