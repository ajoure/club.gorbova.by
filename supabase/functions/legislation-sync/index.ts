import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.108.2";
import { DOMParser } from "npm:linkedom@0.18.12";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ETALON_ORIGIN = "https://etalonline.by";
const CODES_URL = `${ETALON_ORIGIN}/kodeksy/`;

type StructureNode = {
  id: string;
  kind: "title" | "section" | "chapter" | "article" | "paragraph";
  text: string;
  level: number;
};

type ParsedElement = {
  textContent: string | null;
  getAttribute: (name: string) => string | null;
  classList: { contains: (name: string) => boolean };
};

type CuratedDocument = {
  externalId: string;
  title: string;
  collections: Array<"accountant" | "director" | "document_workflow">;
  docType?: string;
  reuseExisting?: boolean;
};

type AuthenticatedSnapshot = {
  externalId: string;
  contentText: string;
};

const CURATED_DOCUMENTS: CuratedDocument[] = [
  // Главному бухгалтеру
  { externalId: "h11300057", title: "О бухгалтерском учете и отчетности", collections: ["accountant"] },
  { externalId: "w21124548", title: "О типовом плане счетов бухгалтерского учета", collections: ["accountant"] },
  { externalId: "w21224697", title: "О бухгалтерском учете доходов и расходов", collections: ["accountant"] },
  { externalId: "w21631602", title: "О составлении индивидуальной бухгалтерской отчетности", collections: ["accountant"] },
  { externalId: "w21428368", title: "Об учетной политике организации, изменениях в учетных оценках, ошибках", collections: ["accountant"] },
  { externalId: "w21226355", title: "О бухгалтерском учете основных средств", collections: ["accountant"] },
  { externalId: "w22339296", title: "О бухгалтерском учете запасов", collections: ["accountant"] },
  { externalId: "w22239291", title: "О бухгалтерском учете курсовых разниц", collections: ["accountant"] },
  { externalId: "w20921041", title: "О порядке начисления амортизации основных средств и нематериальных активов", collections: ["accountant"] },
  { externalId: "w21226095", title: "О порядке расчета стоимости чистых активов", collections: ["accountant"] },
  { externalId: "w21631227", title: "О формах товарно-транспортной и товарной накладных и порядке их заполнения", collections: ["accountant"] },
  { externalId: "w21833222", title: "О единоличном составлении первичных учетных документов", collections: ["accountant"] },
  { externalId: "b22340906", title: "О порядках ведения кассовых операций и расчетов наличными денежными средствами", collections: ["accountant"] },
  { externalId: "w22644816", title: "Об электронном счете-фактуре", collections: ["accountant"] },
  { externalId: "h11300056", title: "Об аудиторской деятельности", collections: ["accountant", "director"] },

  // Руководителю
  { externalId: "v19202020", title: "О хозяйственных обществах", collections: ["director"] },
  { externalId: "h12200227", title: "Об урегулировании неплатежеспособности", collections: ["director"] },
  { externalId: "pd1700007", title: "О развитии предпринимательства", collections: ["director"] },
  { externalId: "h11300016", title: "О коммерческой тайне", collections: ["director", "document_workflow"] },
  { externalId: "h10800455", title: "Об информации, информатизации и защите информации", collections: ["director", "document_workflow"] },
  { externalId: "h12100099", title: "О защите персональных данных", collections: ["director", "document_workflow"] },
  { externalId: "h10900113", title: "Об электронном документе и электронной цифровой подписи", collections: ["director", "document_workflow"] },
  { externalId: "h12200213", title: "О лицензировании", collections: ["director"] },
  { externalId: "h10200090", title: "О защите прав потребителей", collections: ["director"] },
  { externalId: "h10700225", title: "О рекламе", collections: ["director"] },
  { externalId: "h11400128", title: "О государственном регулировании торговли и общественного питания", collections: ["director"] },
  { externalId: "h10800356", title: "Об охране труда", collections: ["director"] },

  // Документооборот и делопроизводство
  { externalId: "h11100323", title: "Об архивном деле и делопроизводстве", collections: ["document_workflow"] },
  { externalId: "w22543773", title: "Инструкция по делопроизводству в государственных органах, иных организациях", collections: ["document_workflow"] },
  { externalId: "w21226212", title: "О перечне типовых документов", collections: ["document_workflow"] },
  { externalId: "w21226204", title: "Правила работы архивов государственных органов и иных организаций", collections: ["document_workflow"] },
  { externalId: "w21933874", title: "О порядке работы с электронными документами", collections: ["document_workflow"] },
  { externalId: "w21933875", title: "Правила работы с документами в электронном виде в архивах", collections: ["document_workflow"] },
  { externalId: "w22441631", title: "О формировании, ведении и хранении личных дел работников", collections: ["document_workflow"] },
  { externalId: "c21001086", title: "О порядке удостоверения формы внешнего представления электронного документа на бумажном носителе", collections: ["document_workflow"] },
  { externalId: "c21400783", title: "О служебной информации ограниченного распространения и коммерческой тайне", collections: ["document_workflow"] },
  { externalId: "w21124071", title: "О порядке учета, хранения и уничтожения защищенных бланков документов", collections: ["accountant", "document_workflow"] },

  // Уже загруженные кодексы только связываются с подборками.
  { externalId: "HK0200166", title: "Налоговый кодекс Республики Беларусь (Общая часть)", collections: ["accountant"], reuseExisting: true },
  { externalId: "HK0900071", title: "Налоговый кодекс Республики Беларусь (Особенная часть)", collections: ["accountant"], reuseExisting: true },
  { externalId: "hk9800218", title: "Гражданский кодекс Республики Беларусь", collections: ["director"], reuseExisting: true },
  { externalId: "HK9900296", title: "Трудовой кодекс Республики Беларусь", collections: ["director"], reuseExisting: true },
  { externalId: "hk2100091", title: "Кодекс Республики Беларусь об административных правонарушениях", collections: ["director"], reuseExisting: true },
  { externalId: "hk2100092", title: "Процессуально-исполнительный кодекс Республики Беларусь об административных правонарушениях", collections: ["director"], reuseExisting: true },
];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeSpace(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeAnchorPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function slugify(value: string) {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
    ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya",
    і: "i", ў: "u",
  };
  return value
    .toLowerCase()
    .split("")
    .map((char) => map[char] ?? char)
    .join("")
    .replace(/[ъь]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ru-RU,ru;q=0.9",
      "User-Agent": "Gorbova-Legislation-Sync/1.0 (+https://gorbova.by)",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`ETALON returned HTTP ${response.status} for ${url}`);
  }
  return await response.text();
}

function parseCodes(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  if (!document) throw new Error("Cannot parse ETALON codes catalogue");

  const result: Array<{ externalId: string; title: string; url: string }> = [];
  const links = Array.from(
    document.querySelectorAll(
      'a[href*="/document/"][href*="regnum="][href*="q_id=6265913"]',
    ),
  ) as ParsedElement[];

  for (const link of links) {
    const title = normalizeSpace(link.textContent ?? "");
    if (!/кодекс/i.test(title)) continue;

    const href = link.getAttribute("href") ?? "";
    const match = href.match(/[?&]regnum=([^&#]+)/i);
    if (!match) continue;
    const externalId = decodeURIComponent(match[1]);
    if (externalId === "f01700314") continue; // Customs Code of the EAEU.
    if (result.some((item) => item.externalId === externalId)) continue;

    result.push({
      externalId,
      title,
      url: new URL(href, ETALON_ORIGIN).toString(),
    });
  }

  if (result.length < 20) {
    throw new Error(`ETALON catalogue parsing guard failed: found ${result.length} codes`);
  }
  return result;
}

function parseDocument(html: string, fallbackTitle: string, sourceUrl: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  if (!document) throw new Error("Cannot parse ETALON document");
  const content = document.querySelector("#userContent");
  if (!content) throw new Error("ETALON document does not contain #userContent");

  const title =
    normalizeSpace(
      document.querySelector("#docTitlePrint .title")?.textContent ??
        document.querySelector("#docTitlePrint .titlencpi")?.textContent ??
        "",
    ) || fallbackTitle;
  const header = normalizeSpace(document.querySelector("#docTitlePrint")?.textContent ?? "");
  const numberMatch = header.match(/№\s*([А-ЯA-Z0-9./-]+)/i);
  const dateMatch = header.match(
    /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})/i,
  );
  const months: Record<string, string> = {
    января: "01", февраля: "02", марта: "03", апреля: "04", мая: "05", июня: "06",
    июля: "07", августа: "08", сентября: "09", октября: "10", ноября: "11", декабря: "12",
  };
  const docDate = dateMatch
    ? `${dateMatch[3]}-${months[dateMatch[2].toLowerCase()]}-${dateMatch[1].padStart(2, "0")}`
    : null;

  const paragraphs = Array.from(content.querySelectorAll("p")) as ParsedElement[];
  if (!paragraphs.length) {
    throw new Error("Legal document parsing guard failed: no paragraphs found");
  }

  const structure: StructureNode[] = [];
  let currentArticle = "";
  let paragraphCounter = 0;
  const usedAnchors = new Set<string>();

  const uniqueAnchor = (candidate: string) => {
    let anchor = candidate || `par-${structure.length + 1}`;
    let suffix = 2;
    while (usedAnchors.has(anchor)) anchor = `${candidate}-${suffix++}`;
    usedAnchors.add(anchor);
    return anchor;
  };

  for (let index = 0; index < paragraphs.length; index++) {
    const node = paragraphs[index];
    if (node.classList.contains("contenttext") || node.classList.contains("changeadd")) {
      continue;
    }
    const text = normalizeSpace(node.textContent ?? "");
    if (!text || text === "ОГЛАВЛЕНИЕ") continue;

    const articleMatch = text.match(/^Статья\s+([\dА-Яа-яІі./-]+)/i);
    const chapterMatch = text.match(/^ГЛАВА\s+([\dА-Яа-яІі./-]+)/i);
    const sectionMatch = text.match(/^РАЗДЕЛ\s+([\dА-Яа-яІі./-]+)/i);
    const pointMatch = text.match(/^(\d+(?:\.\d+)*)[.)]\s*/);
    const isTitle =
      node.classList.contains("title") ||
      node.classList.contains("titlencpi") ||
      node.classList.contains("titleu") ||
      node.classList.contains("cap1") ||
      node.classList.contains("capu1");
    let kind: StructureNode["kind"] = "paragraph";
    let id = "";
    let level = 3;

    if (articleMatch) {
      currentArticle = normalizeAnchorPart(articleMatch[1]);
      paragraphCounter = 0;
      kind = "article";
      id = `art-${currentArticle}`;
      level = 1;
    } else if (chapterMatch) {
      kind = "chapter";
      id = `chapter-${normalizeAnchorPart(chapterMatch[1])}`;
      level = 1;
    } else if (sectionMatch) {
      kind = "section";
      id = `section-${normalizeAnchorPart(sectionMatch[1])}`;
      level = 1;
    } else if (isTitle) {
      kind = "title";
      id = `title-${normalizeAnchorPart(text).slice(0, 72)}`;
      level = 1;
    } else {
      paragraphCounter += 1;
      id = pointMatch && currentArticle
        ? `art-${currentArticle}-p-${normalizeAnchorPart(pointMatch[1])}`
        : pointMatch
          ? `point-${normalizeAnchorPart(pointMatch[1])}`
        : currentArticle
          ? `art-${currentArticle}-par-${paragraphCounter}`
          : `par-${structure.length + 1}`;
    }

    structure.push({ id: uniqueAnchor(id), kind, text, level });
  }

  const contentText = structure.map((node) => node.text).join("\n\n");
  if (contentText.length < 1000 || structure.length < 10) {
    throw new Error("Legal document completeness guard failed");
  }

  return {
    title,
    docNumber: numberMatch?.[1] ?? null,
    docDate,
    contentText,
    structure,
    sourceUrl,
  };
}

// Full text copied by an editor from their authorised legal-system session.
// This deliberately does not accept arbitrary document identifiers: the
// identifier must be in the curated list, so the source, type and collection
// mapping remain canonical and a pasted page cannot create an unrelated act.
function parseAuthenticatedSnapshot(contentText: string, item: CuratedDocument, sourceUrl: string) {
  const lines = contentText
    .split(/\r?\n/)
    .map(normalizeSpace)
    .filter(Boolean);
  const normalizedContent = lines.join("\n\n");
  if (normalizedContent.length < 1000 || lines.length < 10) {
    throw new Error("Legal document completeness guard failed");
  }

  const structure: StructureNode[] = [];
  const usedAnchors = new Set<string>();
  let currentArticle = "";
  let paragraphCounter = 0;
  const uniqueAnchor = (candidate: string) => {
    let anchor = candidate || `par-${structure.length + 1}`;
    let suffix = 2;
    while (usedAnchors.has(anchor)) anchor = `${candidate}-${suffix++}`;
    usedAnchors.add(anchor);
    return anchor;
  };

  for (const text of lines) {
    const articleMatch = text.match(/^Статья\s+([\dА-Яа-яІі./-]+)/i);
    const chapterMatch = text.match(/^ГЛАВА\s+([\dА-Яа-яІі./-]+)/i);
    const sectionMatch = text.match(/^РАЗДЕЛ\s+([\dА-Яа-яІі./-]+)/i);
    const pointMatch = text.match(/^(\d+(?:\.\d+)*)[.)]\s*/);
    let kind: StructureNode["kind"] = "paragraph";
    let id = "";
    let level = 3;

    if (articleMatch) {
      currentArticle = normalizeAnchorPart(articleMatch[1]);
      paragraphCounter = 0;
      kind = "article";
      id = `art-${currentArticle}`;
      level = 1;
    } else if (chapterMatch) {
      kind = "chapter";
      id = `chapter-${normalizeAnchorPart(chapterMatch[1])}`;
      level = 1;
    } else if (sectionMatch) {
      kind = "section";
      id = `section-${normalizeAnchorPart(sectionMatch[1])}`;
      level = 1;
    } else {
      paragraphCounter += 1;
      id = pointMatch && currentArticle
        ? `art-${currentArticle}-p-${normalizeAnchorPart(pointMatch[1])}`
        : pointMatch
          ? `point-${normalizeAnchorPart(pointMatch[1])}`
          : currentArticle
            ? `art-${currentArticle}-par-${paragraphCounter}`
            : `par-${structure.length + 1}`;
    }
    structure.push({ id: uniqueAnchor(id), kind, text, level });
  }

  const header = lines.slice(0, 8).join(" ");
  const numberMatch = header.match(/№\s*([А-ЯA-Z0-9./-]+)/i);
  const dateMatch = header.match(
    /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})/i,
  );
  const months: Record<string, string> = {
    января: "01", февраля: "02", марта: "03", апреля: "04", мая: "05", июня: "06",
    июля: "07", августа: "08", сентября: "09", октября: "10", ноября: "11", декабря: "12",
  };

  return {
    title: item.title,
    docNumber: numberMatch?.[1] ?? null,
    docDate: dateMatch
      ? `${dateMatch[3]}-${months[dateMatch[2].toLowerCase()]}-${dateMatch[1].padStart(2, "0")}`
      : null,
    contentText: normalizedContent,
    structure,
    sourceUrl,
  };
}

async function requireEditor(req: Request, supabaseUrl: string, anonKey: string) {
  const authorization = req.headers.get("Authorization");
  if (!authorization) return null;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) return null;

  const { data: canEdit } = await userClient.rpc("has_permission", {
    _user_id: userData.user.id,
    _permission_code: "content.edit",
  });
  const { data: isSuperAdmin } = await userClient.rpc("is_super_admin", {
    _user_id: userData.user.id,
  });
  return canEdit || isSuperAdmin ? userData.user : null;
}

async function assignCollections(
  admin: SupabaseClient,
  documentId: string,
  collections: CuratedDocument["collections"],
) {
  const rows = collections.map((collectionCode, index) => ({
    collection_code: collectionCode,
    document_id: documentId,
    sort_order: index + 1,
  }));
  const { error } = await admin
    .from("legal_document_collection_items")
    .upsert(rows, { onConflict: "collection_code,document_id" });
  if (error) throw error;
}

async function syncCuratedDocument(
  admin: SupabaseClient,
  editorId: string,
  item: CuratedDocument,
) {
  const { data: existing, error: existingError } = await admin
    .from("legal_documents")
    .select("id,slug,checksum,is_published,structure")
    .eq("source", "etalon")
    .ilike("external_id", item.externalId)
    .maybeSingle();
  if (existingError) throw existingError;

  if (item.reuseExisting) {
    if (!existing) {
      throw new Error(`Existing code ${item.externalId} was not found`);
    }
    await assignCollections(admin, existing.id, item.collections);
    return { status: "linked" as const, documentId: existing.id };
  }

  const sourceUrl = `${ETALON_ORIGIN}/document/?regnum=${encodeURIComponent(item.externalId)}`;
  const parsed = parseDocument(
    await fetchHtml(sourceUrl),
    item.title,
    sourceUrl,
  );
  const checksum = await sha256(parsed.contentText);

  if (existing?.checksum === checksum) {
    const { error: touchError } = await admin
      .from("legal_documents")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (touchError) throw touchError;
    await assignCollections(admin, existing.id, item.collections);
    return { status: "unchanged" as const, documentId: existing.id };
  }

  const revisionKey = checksum.slice(0, 24);
  const documentPayload: Record<string, unknown> = {
    external_id: item.externalId,
    slug: existing?.slug || slugify(parsed.title || item.title),
    source: "etalon",
    source_url: sourceUrl,
    title: parsed.title || item.title,
    doc_type: item.docType ?? "legal_act",
    doc_date: parsed.docDate,
    doc_number: parsed.docNumber,
    category: "acts",
    status: "active",
    content_text: parsed.contentText,
    structure: parsed.structure,
    checksum,
    is_published: true,
    last_synced_at: new Date().toISOString(),
  };
  if (!existing) documentPayload.created_by = editorId;

  const { data: saved, error: saveError } = await admin
    .from("legal_documents")
    .upsert(documentPayload, { onConflict: "source,external_id" })
    .select("id")
    .single();
  if (saveError) throw saveError;

  if (existing?.structure && Array.isArray(existing.structure)) {
    const newAnchorByText = new Map(
      parsed.structure.map((node) => [normalizeSpace(node.text), node.id]),
    );
    const aliases = existing.structure
      .map((node: StructureNode) => ({
        document_id: saved.id,
        old_anchor: node.id,
        current_anchor: newAnchorByText.get(normalizeSpace(node.text)) ?? null,
        status: newAnchorByText.has(normalizeSpace(node.text))
          ? "redirect"
          : "removed",
      }))
      .filter(
        (alias: { old_anchor: string; current_anchor: string | null }) =>
          alias.old_anchor !== alias.current_anchor,
      );
    if (aliases.length) {
      const { error: aliasError } = await admin
        .from("legal_anchor_aliases")
        .upsert(aliases, { onConflict: "document_id,old_anchor" });
      if (aliasError) throw aliasError;
    }
  }

  const { error: oldVersionError } = await admin
    .from("legal_document_versions")
    .update({ is_current: false })
    .eq("document_id", saved.id)
    .eq("is_current", true);
  if (oldVersionError) throw oldVersionError;

  const { error: versionError } = await admin
    .from("legal_document_versions")
    .upsert(
      {
        document_id: saved.id,
        revision_key: revisionKey,
        revision_label: `Актуально на ${new Date().toLocaleDateString("ru-RU")}`,
        content_text: parsed.contentText,
        structure: parsed.structure,
        checksum,
        source_url: sourceUrl,
        is_current: true,
      },
      { onConflict: "document_id,revision_key" },
    );
  if (versionError) throw versionError;

  await assignCollections(admin, saved.id, item.collections);
  return {
    status: existing ? ("updated" as const) : ("created" as const),
    documentId: saved.id,
  };
}

async function importAuthenticatedCuratedSnapshot(
  admin: SupabaseClient,
  editorId: string,
  snapshot: AuthenticatedSnapshot,
) {
  const item = CURATED_DOCUMENTS.find(
    (candidate) => candidate.externalId.toLowerCase() === snapshot.externalId.trim().toLowerCase(),
  );
  if (!item || item.reuseExisting) {
    throw new Error("Документ не входит в список импортируемых нормативных актов");
  }
  const sourceUrl = `${ETALON_ORIGIN}/document/?regnum=${encodeURIComponent(item.externalId)}`;
  const parsed = parseAuthenticatedSnapshot(snapshot.contentText, item, sourceUrl);
  const checksum = await sha256(parsed.contentText);
  const { data: existing, error: existingError } = await admin
    .from("legal_documents")
    .select("id,slug,checksum,structure")
    .eq("source", "etalon")
    .ilike("external_id", item.externalId)
    .maybeSingle();
  if (existingError) throw existingError;

  const revisionKey = checksum.slice(0, 24);
  const documentPayload: Record<string, unknown> = {
    external_id: item.externalId,
    slug: existing?.slug || slugify(parsed.title),
    source: "etalon",
    source_url: sourceUrl,
    title: parsed.title,
    doc_type: item.docType ?? "legal_act",
    doc_date: parsed.docDate,
    doc_number: parsed.docNumber,
    category: "acts",
    status: "active",
    content_text: parsed.contentText,
    structure: parsed.structure,
    checksum,
    is_published: true,
    last_synced_at: new Date().toISOString(),
  };
  if (!existing) documentPayload.created_by = editorId;

  const { data: saved, error: saveError } = await admin
    .from("legal_documents")
    .upsert(documentPayload, { onConflict: "source,external_id" })
    .select("id")
    .single();
  if (saveError) throw saveError;

  if (existing?.structure && Array.isArray(existing.structure)) {
    const newAnchorByText = new Map(
      parsed.structure.map((node) => [normalizeSpace(node.text), node.id]),
    );
    const aliases = existing.structure
      .map((node: StructureNode) => ({
        document_id: saved.id,
        old_anchor: node.id,
        current_anchor: newAnchorByText.get(normalizeSpace(node.text)) ?? null,
        status: newAnchorByText.has(normalizeSpace(node.text)) ? "redirect" : "removed",
      }))
      .filter((alias: { old_anchor: string; current_anchor: string | null }) =>
        alias.old_anchor !== alias.current_anchor,
      );
    if (aliases.length) {
      const { error: aliasError } = await admin
        .from("legal_anchor_aliases")
        .upsert(aliases, { onConflict: "document_id,old_anchor" });
      if (aliasError) throw aliasError;
    }
  }

  const { error: oldVersionError } = await admin
    .from("legal_document_versions")
    .update({ is_current: false })
    .eq("document_id", saved.id)
    .eq("is_current", true);
  if (oldVersionError) throw oldVersionError;
  const { error: versionError } = await admin
    .from("legal_document_versions")
    .upsert({
      document_id: saved.id,
      revision_key: revisionKey,
      revision_label: `Актуально на ${new Date().toLocaleDateString("ru-RU")}`,
      content_text: parsed.contentText,
      structure: parsed.structure,
      checksum,
      source_url: sourceUrl,
      is_current: true,
    }, { onConflict: "document_id,revision_key" });
  if (versionError) throw versionError;

  await assignCollections(admin, saved.id, item.collections);
  return { status: existing ? "updated" : "created", documentId: saved.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const editor = await requireEditor(req, supabaseUrl, anonKey);
    if (!editor) return json(403, { success: false, error: "Недостаточно прав" });

    const body = await req.json().catch(() => ({}));
    if (
      body.action !== "sync_codes" &&
      body.action !== "sync_curated" &&
      body.action !== "import_curated_snapshot"
    ) {
      return json(400, { success: false, error: "Unknown action" });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    if (body.action === "import_curated_snapshot") {
      const externalId = typeof body.externalId === "string" ? body.externalId : "";
      const contentText = typeof body.contentText === "string" ? body.contentText : "";
      const result = await importAuthenticatedCuratedSnapshot(admin, editor.id, {
        externalId,
        contentText,
      });
      await admin
        .from("legislation_settings")
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: "success",
          last_sync_message: `Загружен документ ${externalId}`,
          connection_status: "online",
          last_connection_check: new Date().toISOString(),
        })
        .eq("id", "00000000-0000-0000-0000-000000000001");
      return json(200, { success: true, externalId, ...result });
    }

    if (body.action === "sync_curated") {
      const requestedCursor = Number(body.cursor ?? 0);
      const requestedLimit = Number(body.limit ?? 3);
      const cursor = Number.isFinite(requestedCursor)
        ? Math.max(0, Math.trunc(requestedCursor))
        : 0;
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(5, Math.max(1, Math.trunc(requestedLimit)))
        : 3;
      const batch = CURATED_DOCUMENTS.slice(cursor, cursor + limit);
      const results: Array<{
        externalId: string;
        status?: string;
        error?: string;
      }> = [];

      for (const item of batch) {
        try {
          const result = await syncCuratedDocument(admin, editor.id, item);
          results.push({ externalId: item.externalId, status: result.status });
        } catch (error) {
          results.push({
            externalId: item.externalId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const nextCursor = cursor + batch.length;
      const done = nextCursor >= CURATED_DOCUMENTS.length;
      const failed = results.filter((result) => result.error);
      await admin
        .from("legislation_settings")
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: failed.length ? "partial" : done ? "success" : "running",
          last_sync_message: failed.length
            ? `${failed.length} документов не обновлены`
            : done
              ? `Подборки синхронизированы: ${CURATED_DOCUMENTS.length}`
              : `Подборки: обработано ${nextCursor} из ${CURATED_DOCUMENTS.length}`,
          connection_status: "online",
          last_connection_check: new Date().toISOString(),
        })
        .eq("id", "00000000-0000-0000-0000-000000000001");

      return json(200, {
        success: true,
        partial: failed.length > 0,
        cursor,
        nextCursor: done ? null : nextCursor,
        done,
        total: CURATED_DOCUMENTS.length,
        results,
      });
    }

    const catalogue = parseCodes(await fetchHtml(CODES_URL));
    let updated = 0;
    let unchanged = 0;
    const errors: Array<{ externalId: string; error: string }> = [];

    const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
    for (const code of catalogue) {
      try {
        // Cheap pre-check: skip codes already synced recently to save CPU
        // across sequential invocations (edge-runtime CPU cap).
        const { data: preExisting } = await admin
          .from("legal_documents")
          .select("id,last_synced_at")
          .eq("source", "etalon")
          .eq("external_id", code.externalId)
          .maybeSingle();
        if (
          preExisting?.last_synced_at &&
          Date.now() - new Date(preExisting.last_synced_at).getTime() < FRESH_WINDOW_MS
        ) {
          unchanged += 1;
          continue;
        }

        const parsed = parseDocument(
          await fetchHtml(code.url),
          code.title,
          code.url,
        );
        const checksum = await sha256(parsed.contentText);
        const { data: existing, error: existingError } = await admin
          .from("legal_documents")
          .select("id,slug,checksum,is_published,structure")
          .eq("source", "etalon")
          .eq("external_id", code.externalId)
          .maybeSingle();
        if (existingError) throw existingError;

        if (existing?.checksum === checksum) {
          await admin
            .from("legal_documents")
            .update({ last_synced_at: new Date().toISOString() })
            .eq("id", existing.id);
          unchanged += 1;
          continue;
        }

        const revisionKey = checksum.slice(0, 24);
        const documentPayload: Record<string, unknown> = {
          external_id: code.externalId,
          slug: existing?.slug || slugify(code.title),
          source: "etalon",
          source_url: code.url,
          title: parsed.title,
          doc_type: "code",
          doc_date: parsed.docDate,
          doc_number: parsed.docNumber,
          category: "codes",
          status: "active",
          content_text: parsed.contentText,
          structure: parsed.structure,
          checksum,
          is_published: true,
          last_synced_at: new Date().toISOString(),
          metadata: {
            provider: "ETALON-ONLINE",
            catalogue_url: CODES_URL,
          },
        };
        if (!existing) documentPayload.created_by = editor.id;

        const { data: saved, error: saveError } = await admin
          .from("legal_documents")
          .upsert(documentPayload, { onConflict: "source,external_id" })
          .select("id")
          .single();
        if (saveError) throw saveError;

        if (existing?.structure && Array.isArray(existing.structure)) {
          const newAnchorByText = new Map(
            parsed.structure.map((node) => [normalizeSpace(node.text), node.id]),
          );
          const aliases = existing.structure
            .map((node: StructureNode) => ({
              document_id: saved.id,
              old_anchor: node.id,
              current_anchor: newAnchorByText.get(normalizeSpace(node.text)) ?? null,
              status: newAnchorByText.has(normalizeSpace(node.text)) ? "redirect" : "removed",
            }))
            .filter((alias: { old_anchor: string; current_anchor: string | null }) =>
              alias.old_anchor !== alias.current_anchor
            );
          if (aliases.length) {
            const { error: aliasError } = await admin
              .from("legal_anchor_aliases")
              .upsert(aliases, { onConflict: "document_id,old_anchor" });
            if (aliasError) throw aliasError;
          }
        }

        await admin
          .from("legal_document_versions")
          .update({ is_current: false })
          .eq("document_id", saved.id)
          .eq("is_current", true);

        const { error: versionError } = await admin
          .from("legal_document_versions")
          .upsert({
            document_id: saved.id,
            revision_key: revisionKey,
            revision_label: `Актуально на ${new Date().toLocaleDateString("ru-RU")}`,
            content_text: parsed.contentText,
            structure: parsed.structure,
            checksum,
            source_url: code.url,
            is_current: true,
          }, { onConflict: "document_id,revision_key" });
        if (versionError) throw versionError;
        updated += 1;
      } catch (error) {
        errors.push({
          externalId: code.externalId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await admin
      .from("legislation_settings")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: errors.length ? "partial" : "success",
        last_sync_message: errors.length
          ? `${errors.length} документов не обновлены`
          : `Обработано ${catalogue.length} кодексов`,
        connection_status: "online",
        last_connection_check: new Date().toISOString(),
      })
      .eq("id", "00000000-0000-0000-0000-000000000001");

    return json(errors.length ? 207 : 200, {
      success: true,
      partial: errors.length > 0,
      processed: catalogue.length,
      updated,
      unchanged,
      errors,
    });
  } catch (error) {
    return json(500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
