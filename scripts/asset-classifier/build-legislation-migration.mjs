#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  throw new Error(
    "Usage: node build-legislation-migration.mjs <etalonline-export.json> <migration-output.sql>",
  );
}

const source = JSON.parse(await readFile(inputPath, "utf8"));
const rows = Array.isArray(source.rows) ? source.rows : [];
const footnotes = Array.isArray(source.footnotes) ? source.footnotes : [];

if (rows.length !== 2248) throw new Error(`Expected 2248 rows, got ${rows.length}`);
if (footnotes.length !== 97) {
  throw new Error(`Expected 97 footnotes, got ${footnotes.length}`);
}

const sourceChecksum = createHash("sha256")
  .update(JSON.stringify({ rows, footnotes }))
  .digest("hex");
const expectedChecksum =
  "ac7e28c93b6b3d1f029cec22593157d1624f9de9c7ffee1a811bd60e743b5f4b";
if (sourceChecksum !== expectedChecksum) {
  throw new Error(`Unexpected source checksum: ${sourceChecksum}`);
}

const nodes = [
  {
    id: "document-title",
    kind: "title",
    text: source.source.title,
    level: 1,
  },
  {
    id: "document-date-number",
    kind: "paragraph",
    text: "30 сентября 2011 г. № 161",
    level: 2,
  },
  {
    id: "appendix-normative-lives",
    kind: "section",
    text: "Нормативные сроки службы основных средств",
    level: 1,
  },
  ...rows.map((row) => {
    const code = String(row.code ?? "").trim();
    const life = String(row.normative_life_years ?? "").trim();
    const markers = Array.isArray(row.footnote_markers)
      ? row.footnote_markers.map(String).filter(Boolean)
      : [];
    const finalPosition = /^\d{5}$/.test(code) && /^\d+(?:[.,]\d+)?$/.test(life);
    const id = finalPosition ? `code-${code}` : `row-${row.source_row}`;
    const kind = code.length === 1
      ? "section"
      : code.length === 3 && !life
      ? "chapter"
      : "paragraph";
    const prefix = code ? `${code} — ` : "";
    const lifeText = finalPosition
      ? `\nНормативный срок службы: ${life.replace(",", ".")} лет.`
      : "";
    const markerText = markers.length
      ? `\nПримечание: ${markers.map((marker) => `сноска ${marker}`).join(", ")}.`
      : "";

    return {
      id,
      kind,
      label: code || undefined,
      text: `${prefix}${String(row.name ?? "").trim()}${lifeText}${markerText}`,
      level: kind === "section" ? 1 : kind === "chapter" ? 2 : 3,
    };
  }),
  {
    id: "footnotes",
    kind: "section",
    text: "Примечания к классификации основных средств",
    level: 1,
  },
  ...footnotes.map((footnote) => ({
    id: `footnote-${footnote.marker}`,
    kind: "paragraph",
    label: String(footnote.marker),
    text: `Сноска ${footnote.marker}. ${String(footnote.text).trim()}`,
    level: 3,
  })),
];

const metadata = {
  source_regnum: source.source.regnum,
  source_snapshot_sha256: sourceChecksum,
  source_extracted_at: "2026-07-29",
  consolidated_revision: source.source.consolidated_revision,
  source_rows: rows.length,
  final_positions: rows.filter((row) =>
    /^\d{5}$/.test(String(row.code ?? "")) &&
    /^\d+(?:[.,]\d+)?$/.test(String(row.normative_life_years ?? ""))
  ).length,
  footnotes: footnotes.length,
  internal_path:
    "/knowledge/laws/postanovlenie-minekonomiki-161-2011",
};

function dollar(tag, value) {
  const marker = `$${tag}$`;
  if (String(value).includes(marker)) {
    throw new Error(`Value unexpectedly contains SQL dollar marker ${marker}`);
  }
  return `${marker}${value}${marker}`;
}

const sql = `-- Asset classifier: AI identifies the object; legislation stays internal and deterministic.
-- The source snapshot was extracted from the authenticated consolidated ETALON text.
-- User-facing answers link only to the internal legislation card and exact code anchors.
DO $migration$
DECLARE
  v_prompt_count integer;
  v_existing_document_count integer;
  v_document_id uuid;
  v_existing_checksum text;
  v_content_text text;
  v_structure jsonb := ${dollar("structure161", JSON.stringify(nodes))}::jsonb;
  v_metadata jsonb := ${dollar("metadata161", JSON.stringify(metadata))}::jsonb;
BEGIN
  SELECT string_agg(node.value->>'text', E'\\n\\n' ORDER BY node.ordinality)
  INTO v_content_text
  FROM jsonb_array_elements(v_structure) WITH ORDINALITY AS node(value, ordinality);

  IF v_content_text IS NULL OR btrim(v_content_text) = '' THEN
    RAISE EXCEPTION 'Resolution 161 generated content_text is empty';
  END IF;

  UPDATE public.ai_user_prompts
  SET
    description = 'Гибридный подбор: ИИ определяет тип и назначение объекта, а шифр и нормативный срок выбираются только из внутренней базы законодательства по постановлению Министерства экономики Республики Беларусь № 161.',
    prompt_text = 'SYSTEM: identify the object type and traits only; select codes, legal names and normative lives exclusively from the verified internal Resolution No. 161 catalog.',
    input_hint = 'Опишите объект: наименование, модель, основное назначение, исполнение и ключевые характеристики.',
    launcher_description = 'ИИ распознаёт объект, затем сервис подбирает шифр и нормативный срок только по внутренней базе постановления № 161.'
  WHERE code = 'asset_classifier';

  GET DIAGNOSTICS v_prompt_count = ROW_COUNT;
  IF v_prompt_count <> 1 THEN
    RAISE EXCEPTION
      'asset_classifier prompt update expected exactly 1 row, got %',
      v_prompt_count;
  END IF;

  SELECT count(*)
  INTO v_existing_document_count
  FROM public.legal_documents
  WHERE external_id = 'w21124359';

  IF v_existing_document_count > 1 THEN
    RAISE EXCEPTION
      'Resolution 161 expected at most 1 legal_documents row, got %',
      v_existing_document_count;
  END IF;

  SELECT id, checksum
  INTO v_document_id, v_existing_checksum
  FROM public.legal_documents
  WHERE external_id = 'w21124359'
  LIMIT 1;

  IF v_existing_checksum IS NOT NULL
     AND v_existing_checksum <> '${sourceChecksum}' THEN
    RAISE EXCEPTION
      'Resolution 161 already exists with another checksum; manual review required';
  END IF;

  IF v_document_id IS NULL THEN
    INSERT INTO public.legal_documents (
      external_id,
      slug,
      source,
      source_url,
      search_query,
      title,
      doc_type,
      doc_date,
      doc_number,
      category,
      status,
      organ,
      effective_at,
      revision_label,
      content_text,
      structure,
      checksum,
      metadata,
      is_published,
      last_synced_at
    )
    VALUES (
      'w21124359',
      'postanovlenie-minekonomiki-161-2011',
      'etalon',
      'https://etalonline.by/document/?regnum=w21124359',
      'постановление 161 нормативные сроки службы основных средств',
      ${dollar("title161", source.source.title)},
      'postanovlenie',
      DATE '2011-09-30',
      '161',
      'acts',
      'active',
      'Министерство экономики Республики Беларусь',
      DATE '2012-01-01',
      'Консолидированная редакция с изменениями по 10.04.2017',
      v_content_text,
      v_structure,
      '${sourceChecksum}',
      v_metadata,
      true,
      TIMESTAMPTZ '2026-07-29 00:00:00+00'
    )
    RETURNING id INTO v_document_id;
  ELSE
    UPDATE public.legal_documents
    SET
      slug = 'postanovlenie-minekonomiki-161-2011',
      source = 'etalon',
      source_url = 'https://etalonline.by/document/?regnum=w21124359',
      search_query = 'постановление 161 нормативные сроки службы основных средств',
      title = ${dollar("title161", source.source.title)},
      doc_type = 'postanovlenie',
      doc_date = DATE '2011-09-30',
      doc_number = '161',
      category = 'acts',
      status = 'active',
      organ = 'Министерство экономики Республики Беларусь',
      effective_at = DATE '2012-01-01',
      revision_label = 'Консолидированная редакция с изменениями по 10.04.2017',
      content_text = v_content_text,
      structure = v_structure,
      checksum = '${sourceChecksum}',
      metadata = v_metadata,
      is_published = true,
      last_synced_at = TIMESTAMPTZ '2026-07-29 00:00:00+00'
    WHERE id = v_document_id;
  END IF;

  UPDATE public.legal_document_versions
  SET is_current = false
  WHERE document_id = v_document_id
    AND is_current;

  INSERT INTO public.legal_document_versions (
    document_id,
    revision_key,
    revision_label,
    effective_at,
    content_text,
    structure,
    checksum,
    source_url,
    is_current
  )
  VALUES (
    v_document_id,
    '2017-04-10-etalon-w21124359',
    'Консолидированная редакция с изменениями по 10.04.2017',
    DATE '2012-01-01',
    v_content_text,
    v_structure,
    '${sourceChecksum}',
    'https://etalonline.by/document/?regnum=w21124359',
    true
  )
  ON CONFLICT (document_id, revision_key) DO UPDATE
  SET
    revision_label = EXCLUDED.revision_label,
    effective_at = EXCLUDED.effective_at,
    content_text = EXCLUDED.content_text,
    structure = EXCLUDED.structure,
    checksum = EXCLUDED.checksum,
    source_url = EXCLUDED.source_url,
    is_current = true;
END
$migration$;
`;

await writeFile(outputPath, sql, "utf8");
