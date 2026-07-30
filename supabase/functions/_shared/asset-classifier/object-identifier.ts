export type IdentificationConfidence = "high" | "medium" | "low";

export interface IdentifiedAssetObject {
  originalName: string;
  normalizedName: string;
  objectType: string;
  possibleSubtypes: string[];
  primaryFunction: string;
  secondaryFunctions: string[];
  installationContext: string;
  connectionType: string;
  material: string;
  isProbableComponent: boolean;
  componentOf: string;
  missingCharacteristics: string[];
  searchPhrases: string[];
  positiveMarkers: string[];
  negativeMarkers: string[];
  confidence: IdentificationConfidence;
}

export interface IdentificationOutcome {
  object: IdentifiedAssetObject;
  source: "gemini" | "deterministic_fallback";
  fallbackReason?: "missing_api_key" | "timeout" | "rate_limit" | "provider_error" | "invalid_response";
}

type FetchLike = typeof fetch;

const GEMINI_MODEL = "google/gemini-3.6-flash";
const LOVABLE_AI_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GEMINI_MAX_OUTPUT_TOKENS = 4_096;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    original_name: { type: "string" },
    normalized_name: { type: "string" },
    object_type: { type: "string" },
    possible_subtypes: { type: "array", items: { type: "string" } },
    primary_function: { type: "string" },
    secondary_functions: { type: "array", items: { type: "string" } },
    installation_context: { type: "string" },
    connection_type: { type: "string" },
    material: { type: "string" },
    is_probable_component: { type: "boolean" },
    component_of: { type: "string" },
    missing_characteristics: { type: "array", items: { type: "string" } },
    search_phrases: { type: "array", items: { type: "string" } },
    positive_markers: { type: "array", items: { type: "string" } },
    negative_markers: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: [
    "original_name",
    "normalized_name",
    "object_type",
    "possible_subtypes",
    "primary_function",
    "secondary_functions",
    "installation_context",
    "connection_type",
    "material",
    "is_probable_component",
    "component_of",
    "missing_characteristics",
    "search_phrases",
    "positive_markers",
    "negative_markers",
    "confidence",
  ],
} as const;

const SYSTEM_INSTRUCTION = `
Ты определяешь реальный тип объекта основных средств по пользовательскому описанию.
Верни только JSON по заданной схеме.

Правила:
1. Не выбирай шифр, код, срок службы и норму законодательства.
2. Не придумывай отсутствующие характеристики. Неизвестное оставляй пустой строкой
   и перечисляй в missing_characteristics.
3. Сначала определи, что это за физический объект, затем его основную функцию.
4. Отличай конечное устройство от инфраструктуры и сооружений. Смартфон или iPhone —
   сотовый телефон, а не линия связи, антенна, базовая станция или подземное сооружение.
5. Отличай самостоятельный объект от комплектующей или запасной части.
6. search_phrases должны быть короткими нормативно-поисковыми формулировками на русском.
7. negative_markers перечисляют формулировки, явно несовместимые с объектом.
8. Если описания недостаточно для выбора разновидности, понизь confidence и задай
   конкретные missing_characteristics.
`.trim();

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedString(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function boundedStrings(value: unknown, maxItems = 12): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => boundedString(item, 120))
      .filter(Boolean),
  )).slice(0, maxItems);
}

export function parseIdentifiedAssetObject(
  value: unknown,
  originalQuery: string,
): IdentifiedAssetObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const confidence = source.confidence;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") return null;

  const normalizedName = boundedString(source.normalized_name);
  const objectType = boundedString(source.object_type);
  if (!normalizedName || !objectType) return null;

  return {
    originalName: boundedString(source.original_name) || originalQuery.trim().slice(0, 300),
    normalizedName,
    objectType,
    possibleSubtypes: boundedStrings(source.possible_subtypes),
    primaryFunction: boundedString(source.primary_function),
    secondaryFunctions: boundedStrings(source.secondary_functions),
    installationContext: boundedString(source.installation_context),
    connectionType: boundedString(source.connection_type),
    material: boundedString(source.material),
    isProbableComponent: source.is_probable_component === true,
    componentOf: boundedString(source.component_of),
    missingCharacteristics: boundedStrings(source.missing_characteristics),
    searchPhrases: boundedStrings(source.search_phrases),
    positiveMarkers: boundedStrings(source.positive_markers),
    negativeMarkers: boundedStrings(source.negative_markers),
    confidence,
  };
}

interface LocalRule {
  pattern: RegExp;
  normalizedName: string;
  objectType: string;
  primaryFunction: string;
  searchPhrases: string[];
  negativeMarkers?: string[];
  confidence?: IdentificationConfidence;
  missingCharacteristics?: string[];
  isProbableComponent?: boolean;
  componentOf?: string;
}

const LOCAL_RULES: LocalRule[] = [
  {
    pattern: /(iphone|айфон|смартфон|мобильн.*телефон|телефон.*мобильн|сотов.*телефон|телефон.*сотов)/i,
    normalizedName: "телефон сотовый",
    objectType: "сотовый телефон",
    primaryFunction: "мобильная голосовая связь и передача данных",
    searchPhrases: ["телефоны сотовые", "сотовый телефон", "мобильный телефон"],
    negativeMarkers: ["подземные сооружения", "линии связи", "антенны", "базовые станции"],
  },
  {
    pattern: /(стационарн.*телефон|проводн.*телефон|радиотелефон)/i,
    normalizedName: "аппарат телефонный общего применения",
    objectType: "телефонный аппарат",
    primaryFunction: "голосовая связь по телефонной сети",
    searchPhrases: ["аппараты телефонные общего применения", "телефон шнуровой", "телефон бесшнуровой"],
    negativeMarkers: ["телефоны сотовые", "телефонная станция", "линии связи"],
  },
  {
    pattern: /(ноутбук|лэптоп|laptop|macbook)/i,
    normalizedName: "ноутбук",
    objectType: "портативный персональный компьютер",
    primaryFunction: "обработка информации и запуск пользовательских программ",
    searchPhrases: ["портативные компьютеры", "ноутбуки", "электронно вычислительные машины персональные"],
    negativeMarkers: ["аккумуляторы", "серверы центра обработки данных"],
  },
  {
    pattern: /(планшет|ipad)/i,
    normalizedName: "планшетный компьютер",
    objectType: "планшетный компьютер",
    primaryFunction: "мобильная обработка информации",
    searchPhrases: ["планшетный компьютер"],
    negativeMarkers: ["планшетные из пенокартона", "аккумуляторы"],
  },
  {
    pattern: /(сервер|серверн.*комплекс|дисков.*массив|кластер)/i,
    normalizedName: "сервер центра обработки данных",
    objectType: "серверный программно технический комплекс",
    primaryFunction: "централизованная обработка и хранение данных",
    searchPhrases: ["комплексы серверов центра обработки данных", "комплексы кластеров", "комплексы дискового массива"],
    negativeMarkers: ["портативные компьютеры", "оборудование малых офисов"],
  },
  {
    pattern: /(мфу|многофункциональн.*устройств|принтер|сканер|плоттер|монитор|ибп|источник.*бесперебойн.*питан)/i,
    normalizedName: "периферийное устройство персонального компьютера",
    objectType: "периферийное устройство вычислительного комплекса",
    primaryFunction: "ввод вывод или обеспечение работы вычислительной техники",
    searchPhrases: ["устройства периферийные вычислительных комплексов", "сканеры принтеры многофункциональные устройства"],
    negativeMarkers: ["копировально множительная техника промышленная"],
  },
  {
    pattern: /(факс|факсимильн.*аппарат)/i,
    normalizedName: "аппарат факсимильный",
    objectType: "факсимильный аппарат",
    primaryFunction: "передача и прием факсимильных сообщений",
    searchPhrases: ["аппараты факсимильные"],
  },
  {
    pattern: /(бытов.*кондиционер|кондиционер.*(офисн|домашн)|сплит.*систем)/i,
    normalizedName: "кондиционер бытовой",
    objectType: "бытовой кондиционер",
    primaryFunction: "охлаждение и кондиционирование воздуха в помещении",
    searchPhrases: ["кондиционеры бытовые"],
    negativeMarkers: ["промышленная вентиляционная система", "климатические испытания"],
  },
  {
    pattern: /(холодильник|морозильник|морозильн.*камер)/i,
    normalizedName: "холодильное оборудование",
    objectType: "холодильник или морозильная камера",
    primaryFunction: "охлаждение и хранение продукции",
    searchPhrases: ["холодильники камеры бытовые морозильные", "оборудование холодильное"],
    confidence: "medium",
    missingCharacteristics: ["бытовое или промышленное исполнение"],
  },
  {
    pattern: /(аккумулятор|батаре)/i,
    normalizedName: "аккумулятор электрический",
    objectType: "аккумулятор или батарея",
    primaryFunction: "накопление и подача электрической энергии",
    searchPhrases: ["аккумуляторы электрические"],
    confidence: "medium",
    missingCharacteristics: ["для какого оборудования предназначен аккумулятор"],
    isProbableComponent: true,
  },
  {
    pattern: /(картридж|запасн.*част|комплектующ|детал)/i,
    normalizedName: "комплектующая или запасная часть",
    objectType: "комплектующая",
    primaryFunction: "работа в составе другого объекта",
    searchPhrases: [],
    confidence: "low",
    missingCharacteristics: ["самостоятельная функция объекта", "объект, в составе которого используется"],
    isProbableComponent: true,
  },
];

export function identifyObjectLocally(query: string): IdentifiedAssetObject {
  const normalizedQuery = normalize(query);
  const matchingRules = LOCAL_RULES.filter((candidate) =>
    candidate.pattern.test(normalizedQuery)
  );
  const rule = /(аккумулятор|батаре|картридж|запасн.*част|комплектующ|детал)/i
      .test(normalizedQuery)
    ? matchingRules.find((candidate) => candidate.isProbableComponent) ?? matchingRules[0]
    : matchingRules[0];
  if (!rule) {
    return {
      originalName: query.trim().slice(0, 300),
      normalizedName: normalizedQuery.slice(0, 300),
      objectType: normalizedQuery.slice(0, 160) || "неопределенный объект",
      possibleSubtypes: [],
      primaryFunction: "",
      secondaryFunctions: [],
      installationContext: "",
      connectionType: "",
      material: "",
      isProbableComponent: false,
      componentOf: "",
      missingCharacteristics: [
        "точное наименование или модель",
        "основное назначение",
        "ключевые технические характеристики",
      ],
      searchPhrases: normalizedQuery ? [normalizedQuery.slice(0, 120)] : [],
      positiveMarkers: normalizedQuery.split(" ").filter((token) => token.length >= 4).slice(0, 8),
      negativeMarkers: [],
      confidence: "low",
    };
  }

  return {
    originalName: query.trim().slice(0, 300),
    normalizedName: rule.normalizedName,
    objectType: rule.objectType,
    possibleSubtypes: [],
    primaryFunction: rule.primaryFunction,
    secondaryFunctions: [],
    installationContext: "",
    connectionType: "",
    material: "",
    isProbableComponent: rule.isProbableComponent ?? false,
    componentOf: rule.componentOf ?? "",
    missingCharacteristics: rule.missingCharacteristics ?? [],
    searchPhrases: rule.searchPhrases,
    positiveMarkers: rule.searchPhrases,
    negativeMarkers: rule.negativeMarkers ?? [],
    confidence: rule.confidence ?? "high",
  };
}

function fallbackReason(status?: number): IdentificationOutcome["fallbackReason"] {
  if (status === 429) return "rate_limit";
  return "provider_error";
}

export async function identifyObjectWithGemini(
  query: string,
  lovableApiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 12_000,
): Promise<IdentificationOutcome> {
  if (!lovableApiKey) {
    return {
      object: identifyObjectLocally(query),
      source: "deterministic_fallback",
      fallbackReason: "missing_api_key",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(LOVABLE_AI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        messages: [
          {
            role: "system",
            content:
              `${SYSTEM_INSTRUCTION}\n\nJSON Schema:\n${JSON.stringify(RESPONSE_SCHEMA)}`,
          },
          { role: "user", content: query },
        ],
        reasoning_effort: "minimal",
        max_tokens: GEMINI_MAX_OUTPUT_TOKENS,
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        object: identifyObjectLocally(query),
        source: "deterministic_fallback",
        fallbackReason: fallbackReason(response.status),
      };
    }

    const payload = await response.json().catch(() => null) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;
    const text = payload?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return {
        object: identifyObjectLocally(query),
        source: "deterministic_fallback",
        fallbackReason: "invalid_response",
      };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      return {
        object: identifyObjectLocally(query),
        source: "deterministic_fallback",
        fallbackReason: "invalid_response",
      };
    }
    const object = parseIdentifiedAssetObject(parsedJson, query);
    if (!object) {
      return {
        object: identifyObjectLocally(query),
        source: "deterministic_fallback",
        fallbackReason: "invalid_response",
      };
    }

    return { object, source: "gemini" };
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    return {
      object: identifyObjectLocally(query),
      source: "deterministic_fallback",
      fallbackReason: isTimeout ? "timeout" : "provider_error",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export const GEMINI_OBJECT_IDENTIFIER_MODEL = GEMINI_MODEL;
