import { createClient } from "npm:@supabase/supabase-js@2.108.2";
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
  kind: "section" | "chapter" | "article" | "paragraph";
  text: string;
  level: number;
};

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
  );

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
    normalizeSpace(document.querySelector("#docTitlePrint p")?.textContent ?? "") ||
    fallbackTitle;
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

  const paragraphs = Array.from(content.querySelectorAll("p"));
  const firstArticleIndex = paragraphs.findIndex((node) =>
    node.classList.contains("article")
  );
  if (firstArticleIndex < 0) {
    throw new Error("ETALON document parsing guard failed: no articles found");
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

  for (let index = Math.max(0, firstArticleIndex - 8); index < paragraphs.length; index++) {
    const node = paragraphs[index];
    if (node.classList.contains("contenttext") || node.classList.contains("changeadd")) {
      continue;
    }
    const text = normalizeSpace(node.textContent ?? "");
    if (!text || text === "ОГЛАВЛЕНИЕ") continue;

    const articleMatch = text.match(/^Статья\s+([\dА-Яа-яІі./-]+)/i);
    const chapterMatch = text.match(/^ГЛАВА\s+([\dА-Яа-яІі./-]+)/i);
    const sectionMatch = text.match(/^РАЗДЕЛ\s+([\dА-Яа-яІі./-]+)/i);
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
      const pointMatch = text.match(/^(\d+(?:\.\d+)*)[.)]\s/);
      id = pointMatch && currentArticle
        ? `art-${currentArticle}-p-${normalizeAnchorPart(pointMatch[1])}`
        : currentArticle
          ? `art-${currentArticle}-par-${paragraphCounter}`
          : `par-${structure.length + 1}`;
    }

    structure.push({ id: uniqueAnchor(id), kind, text, level });
  }

  const contentText = structure.map((node) => node.text).join("\n\n");
  if (contentText.length < 5000 || structure.filter((node) => node.kind === "article").length < 5) {
    throw new Error("ETALON document completeness guard failed");
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
    if (body.action !== "sync_codes") {
      return json(400, { success: false, error: "Unknown action" });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
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
