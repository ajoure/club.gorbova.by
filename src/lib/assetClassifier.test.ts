import { describe, expect, it } from "vitest";
import { ASSET_CLASSIFIER_CATALOG } from "../../supabase/functions/_shared/asset-classifier/catalog-161";
import { classifyAsset } from "../../supabase/functions/_shared/asset-classifier/engine";
import {
  identifyObjectLocally,
  identifyObjectWithGemini,
  parseIdentifiedAssetObject,
} from "../../supabase/functions/_shared/asset-classifier/object-identifier";

describe("asset classifier catalog", () => {
  it("contains the complete verified legal catalog", () => {
    expect(ASSET_CLASSIFIER_CATALOG.stats).toEqual({
      sourceRows: 2248,
      finalPositions: 1900,
      hierarchyPositions: 116,
      footnotes: 97,
    });
    expect(new Set(ASSET_CLASSIFIER_CATALOG.items.map((item) => item.code)).size).toBe(1900);
  });

  it("returns an exact legal position when the user supplies a cipher", () => {
    const result = classifyAsset("Проверить шифр 48009 для ноутбука");

    expect(result.decision).toBe("recommended");
    expect(result.candidates[0]).toMatchObject({
      code: "48009",
      normativeLifeYears: 4,
    });
    expect(result.candidates[0].footnotes[0]).toMatchObject({ marker: "83" });
  });

  it("selects the notebook position using the deterministic fallback", () => {
    const result = classifyAsset(
      "Ноутбук Lenovo, портативный персональный компьютер для работы бухгалтера",
    );

    expect(result.decision).toBe("recommended");
    expect(result.candidates[0].code).toBe("48009");
    expect(result.content).toContain("постановление");
  });

  it("asks for clarification when the description is too generic", () => {
    const result = classifyAsset("оборудование");

    expect(["clarification", "not_found"]).toContain(result.decision);
    expect(result.content).toMatch(/уточн|требуется/i);
  });
});

describe("asset classifier golden set", () => {
  const goldenCases: Array<[query: string, expectedCode: string]> = [
    ["мобильный телефон", "70034"],
    ["смартфон Samsung Galaxy S25", "70034"],
    ["iPhone 16 Pro", "70034"],
    ["айфон для директора", "70034"],
    ["сотовый телефон Nokia", "70034"],
    ["Android смартфон", "70034"],
    ["телефон мобильный для звонков и интернета", "70034"],
    ["корпоративный смартфон Xiaomi", "70034"],
    ["стационарный телефон", "70040"],
    ["проводной телефон Panasonic", "70040"],
    ["радиотелефон DECT", "70040"],
    ["телефонный аппарат общего применения", "70040"],
    ["ноутбук Lenovo ThinkPad", "48009"],
    ["лэптоп для бухгалтера", "48009"],
    ["laptop Dell Latitude", "48009"],
    ["MacBook Pro", "48009"],
    ["портативный персональный компьютер", "48009"],
    ["ноутбук HP для офисной работы", "48009"],
    ["переносной ноутбук Asus", "48009"],
    ["ноутбук Acer", "48009"],
    ["планшетный компьютер", "48016"],
    ["планшет Samsung Galaxy Tab", "48016"],
    ["iPad Air", "48016"],
    ["рабочий планшет Lenovo", "48016"],
    ["планшет для выездной работы", "48016"],
    ["сервер центра обработки данных", "48012"],
    ["серверный комплекс", "48012"],
    ["кластер серверов ЦОД", "48012"],
    ["дисковый массив центра обработки данных", "48012"],
    ["серверный кластер для базы данных", "48012"],
    ["принтер лазерный", "48003"],
    ["МФУ Canon", "48003"],
    ["многофункциональное устройство печать сканирование копирование", "48003"],
    ["сканер документов", "48003"],
    ["плоттер широкоформатный", "48003"],
    ["монитор для персонального компьютера", "48003"],
    ["источник бесперебойного питания для компьютера", "48003"],
    ["ИБП для вычислительной техники", "48003"],
    ["факс", "70033"],
    ["аппарат факсимильный", "70033"],
    ["бытовой кондиционер", "70041"],
    ["офисный кондиционер", "70041"],
    ["сплит система для кабинета", "70041"],
    ["микроволновая печь", "70100"],
    ["микроволновка в комнату приема пищи", "70100"],
    ["пылесос бытовой", "70100"],
    ["посудомоечная машина", "70101"],
    ["стиральная машина", "70101"],
    ["видеокамера", "70105"],
    ["телевизор", "70105"],
    ["видеорегистратор", "70105"],
    ["фотоаппарат", "70106"],
    ["цифровая фотокамера", "70106"],
  ];

  it.each(goldenCases)("%s -> %s", (query, expectedCode) => {
    const result = classifyAsset(query);

    expect(result.candidates[0]?.code).toBe(expectedCode);
  });

  it("does not confuse a mobile phone with communications infrastructure", () => {
    const result = classifyAsset("мобильный телефон");

    expect(result.decision).toBe("recommended");
    expect(result.candidates[0].code).toBe("70034");
    expect(result.candidates.map((candidate) => candidate.code)).not.toEqual(
      expect.arrayContaining(["20389", "20805", "30037"]),
    );
    expect(result.content).toContain("Тип объекта:");
    expect(result.content).toContain("ИИ используется только для распознавания");
    expect(result.content).toContain(
      "https://club.gorbova.by/knowledge/laws/postanovlenie-minekonomiki-161-2011#code-70034",
    );
    expect(result.content).not.toContain("etalonline.by");
  });

  it("asks for the execution type instead of guessing a refrigerator code", () => {
    const result = classifyAsset("холодильник");

    expect(result.decision).toBe("clarification");
    expect(result.candidates.map((candidate) => candidate.code)).toEqual(["70102", "45800"]);
    expect(result.clarifyingQuestions.join(" ")).toMatch(/бытов|промышлен/i);
  });

  it("does not return random catalog positions for an unknown object", () => {
    const result = classifyAsset("неизвестный экспериментальный объект xyz");

    expect(result.decision).toBe("not_found");
    expect(result.candidates).toEqual([]);
    expect(result.content).toContain("не будет подставлять случайный шифр");
    expect(result.content).toContain(
      "https://club.gorbova.by/knowledge/laws/postanovlenie-minekonomiki-161-2011",
    );
    expect(result.content).not.toContain("etalonline.by");
  });

  it("flags a cartridge as a component instead of treating it as a printer", () => {
    const result = classifyAsset("картридж для принтера");

    expect(result.decision).not.toBe("recommended");
    expect(result.identifiedObject.isProbableComponent).toBe(true);
    expect(result.content).toContain("комплектующую или запасную часть");
  });
});

describe("Gemini object identification boundary", () => {
  it("uses the deterministic fallback when no managed API key is configured", async () => {
    const result = await identifyObjectWithGemini("мобильный телефон", undefined);

    expect(result.source).toBe("deterministic_fallback");
    expect(result.fallbackReason).toBe("missing_api_key");
    expect(result.object.objectType).toBe("сотовый телефон");
  });

  it("accepts only a structurally valid object description from Gemini", async () => {
    const geminiPayload = {
      original_name: "iPhone 16 Pro",
      normalized_name: "телефон сотовый",
      object_type: "сотовый телефон",
      possible_subtypes: ["смартфон"],
      primary_function: "мобильная связь и передача данных",
      secondary_functions: ["фотосъемка"],
      installation_context: "переносное устройство",
      connection_type: "сотовая сеть",
      material: "",
      is_probable_component: false,
      component_of: "",
      missing_characteristics: [],
      search_phrases: ["телефоны сотовые", "сотовый телефон"],
      positive_markers: ["смартфон", "мобильная связь"],
      negative_markers: ["линии связи", "антенны", "подземные сооружения"],
      confidence: "high",
    };
    let requestedUrl = "";
    let authorization = "";
    let requestedBody: Record<string, unknown> = {};
    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      requestedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(geminiPayload) } }],
      }), { status: 200 });
    }) as typeof fetch;

    const result = await identifyObjectWithGemini(
      "iPhone 16 Pro",
      "test-key-not-a-real-secret",
      mockFetch,
    );

    expect(result.source).toBe("gemini");
    expect(result.object.objectType).toBe("сотовый телефон");
    expect(requestedUrl).toBe("https://ai.gateway.lovable.dev/v1/chat/completions");
    expect(authorization).toBe("Bearer test-key-not-a-real-secret");
    expect(requestedBody.model).toBe("google/gemini-3.6-flash");
    expect(requestedBody.reasoning_effort).toBe("minimal");
    expect(requestedBody.max_tokens).toBe(4_096);
    expect(requestedBody).not.toHaveProperty("temperature");
    expect(requestedBody.response_format).toEqual({ type: "json_object" });
  });

  it("rejects invalid structured data before classification", () => {
    expect(parseIdentifiedAssetObject({
      normalized_name: "",
      object_type: "",
      confidence: "certain",
    }, "объект")).toBeNull();
  });

  it("keeps a valid low-confidence Gemini unknown instead of misreporting a fallback", async () => {
    const unknownPayload = {
      original_name: "абракадабра xyz",
      normalized_name: "",
      object_type: "",
      possible_subtypes: [],
      primary_function: "",
      secondary_functions: [],
      installation_context: "",
      connection_type: "",
      material: "",
      is_probable_component: false,
      component_of: "",
      missing_characteristics: [
        "точное наименование объекта",
        "основное назначение",
        "ключевые характеристики",
      ],
      search_phrases: [],
      positive_markers: [],
      negative_markers: [],
      confidence: "low",
    };
    const mockFetch = (async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(unknownPayload) } }],
      }), { status: 200 })) as typeof fetch;

    const result = await identifyObjectWithGemini(
      "абракадабра xyz",
      "test-key-not-a-real-secret",
      mockFetch,
    );

    expect(result.source).toBe("gemini");
    expect(result.fallbackReason).toBeUndefined();
    expect(result.object).toMatchObject({
      normalizedName: "абракадабра xyz",
      objectType: "неопределенный объект",
      confidence: "low",
    });
    expect(classifyAsset("абракадабра xyz", result.object)).toMatchObject({
      decision: "not_found",
      candidates: [],
    });
  });

  it("falls back safely on a provider rate limit", async () => {
    const mockFetch = (async () =>
      new Response(JSON.stringify({ error: "quota" }), { status: 429 })) as typeof fetch;

    const result = await identifyObjectWithGemini(
      "ноутбук",
      "test-key-not-a-real-secret",
      mockFetch,
    );

    expect(result.source).toBe("deterministic_fallback");
    expect(result.fallbackReason).toBe("rate_limit");
    expect(result.object.objectType).toBe("портативный персональный компьютер");
  });

  it("falls back safely when Gemini returns malformed JSON", async () => {
    const mockFetch = (async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: "{not-json" } }],
      }), { status: 200 })) as typeof fetch;

    const result = await identifyObjectWithGemini(
      "планшет",
      "test-key-not-a-real-secret",
      mockFetch,
    );

    expect(result.source).toBe("deterministic_fallback");
    expect(result.fallbackReason).toBe("invalid_response");
    expect(result.object.objectType).toBe("планшетный компьютер");
  });
});
