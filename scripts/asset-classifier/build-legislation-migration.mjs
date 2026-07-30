#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [inputPath, outputDirectory] = process.argv.slice(2);

if (!inputPath || !outputDirectory) {
  throw new Error(
    "Usage: node build-legislation-migration.mjs <etalonline-export.json|combined-migration.sql> <migration-output-directory>",
  );
}

const expectedChecksum =
  "ac7e28c93b6b3d1f029cec22593157d1624f9de9c7ffee1a811bd60e743b5f4b";
const input = await readFile(inputPath, "utf8");
let sourceChecksum;
let nodes;
let metadata;
let title;

if (inputPath.endsWith(".sql")) {
  const structureMatch = input.match(
    /v_structure jsonb := \$structure161\$([\s\S]*?)\$structure161\$::jsonb;/,
  );
  const metadataMatch = input.match(
    /v_metadata jsonb := \$metadata161\$([\s\S]*?)\$metadata161\$::jsonb;/,
  );
  if (!structureMatch || !metadataMatch) {
    throw new Error("Combined migration does not contain Resolution 161 payload");
  }
  nodes = JSON.parse(structureMatch[1]);
  metadata = JSON.parse(metadataMatch[1]);
  sourceChecksum = metadata.source_snapshot_sha256;
  title = nodes[0]?.text;
} else {
  const source = JSON.parse(input);
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const footnotes = Array.isArray(source.footnotes) ? source.footnotes : [];

  if (rows.length !== 2248) throw new Error(`Expected 2248 rows, got ${rows.length}`);
  if (footnotes.length !== 97) {
    throw new Error(`Expected 97 footnotes, got ${footnotes.length}`);
  }

  sourceChecksum = createHash("sha256")
    .update(JSON.stringify({ rows, footnotes }))
    .digest("hex");
  nodes = [
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
      const finalPosition = /^\d{5}$/.test(code) &&
        /^\d+(?:[.,]\d+)?$/.test(life);
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
  metadata = {
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
  title = source.source.title;
}

if (sourceChecksum !== expectedChecksum) {
  throw new Error(`Unexpected source checksum: ${sourceChecksum}`);
}
const seenNodeIds = new Map();
nodes = nodes.map((node) => {
  const occurrence = (seenNodeIds.get(node.id) ?? 0) + 1;
  seenNodeIds.set(node.id, occurrence);
  return occurrence === 1 ? node : { ...node, id: `${node.id}-${occurrence}` };
});
if (nodes.length !== 2349) {
  throw new Error(`Expected 2349 legislation nodes, got ${nodes.length}`);
}
if (new Set(nodes.map((node) => node.id)).size !== nodes.length) {
  const counts = new Map();
  for (const node of nodes) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
  const duplicates = [...counts].filter(([, count]) => count > 1);
  throw new Error(`Legislation node ids must be unique: ${JSON.stringify(duplicates)}`);
}
if (!nodes.some((node) => node.id === "code-70034")) {
  throw new Error("Legislation payload does not contain code-70034");
}

function dollar(tag, value) {
  const marker = `$${tag}$`;
  if (String(value).includes(marker)) {
    throw new Error(`Value unexpectedly contains SQL dollar marker ${marker}`);
  }
  return `${marker}${value}${marker}`;
}

const maxChunkBytes = 60_000;
const chunks = [];
let chunk = [];
for (const node of nodes) {
  const candidate = [...chunk, node];
  if (chunk.length && Buffer.byteLength(JSON.stringify(candidate), "utf8") > maxChunkBytes) {
    chunks.push(chunk);
    chunk = [node];
  } else {
    chunk = candidate;
  }
}
if (chunk.length) chunks.push(chunk);

await mkdir(outputDirectory, { recursive: true });

const stageMetadata = {
  ...metadata,
  resolution_161_import: {
    expected_nodes: nodes.length,
    expected_batches: chunks.length,
    applied_batches: [],
    state: "staging",
  },
};

const stageSql = `-- Stage Resolution 161 as unpublished content before managed batch import.
DO $migration$
DECLARE
  v_existing_document_count integer;
  v_document_id uuid;
  v_existing_checksum text;
  v_metadata jsonb := ${dollar("metadata161", JSON.stringify(stageMetadata))}::jsonb;
BEGIN
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
      ${dollar("title161", title)},
      'postanovlenie',
      DATE '2011-09-30',
      '161',
      'acts',
      'active',
      'Министерство экономики Республики Беларусь',
      DATE '2012-01-01',
      'Консолидированная редакция с изменениями по 10.04.2017',
      NULL,
      '[]'::jsonb,
      NULL,
      v_metadata,
      false,
      TIMESTAMPTZ '2026-07-29 00:00:00+00'
    )
    RETURNING id INTO v_document_id;
  ELSE
    IF v_existing_checksum = '${sourceChecksum}'
       AND jsonb_array_length(COALESCE(
         (SELECT structure FROM public.legal_documents WHERE id = v_document_id),
         '[]'::jsonb
       )) = 2349 THEN
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.legal_documents
      WHERE id = v_document_id AND is_published
    ) THEN
      RAISE EXCEPTION 'Resolution 161 partial import cannot overwrite published content';
    END IF;
  END IF;
END
$migration$;
`;

const batchSql = chunks.map((nodesChunk, index) => {
  const batch = String(index + 1).padStart(2, "0");
  const expectedStart = chunks.slice(0, index).reduce((sum, item) => sum + item.length, 0);
  const expectedEnd = expectedStart + nodesChunk.length;
  return `-- Append Resolution 161 nodes ${expectedStart + 1}-${expectedEnd}; idempotent managed batch ${batch}.
DO $migration$
DECLARE
  v_document_id uuid;
  v_structure_length integer;
  v_chunk jsonb := ${dollar(`batch161_${batch}`, JSON.stringify(nodesChunk))}::jsonb;
BEGIN
  SELECT id, jsonb_array_length(structure)
  INTO v_document_id, v_structure_length
  FROM public.legal_documents
  WHERE external_id = 'w21124359'
  LIMIT 1;

  IF v_document_id IS NULL THEN
    RAISE EXCEPTION 'Resolution 161 staging document is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.legal_documents
    WHERE id = v_document_id
      AND checksum = '${sourceChecksum}'
      AND is_published
      AND jsonb_array_length(structure) = 2349
  ) THEN
    IF (
      SELECT count(*)
      FROM jsonb_array_elements(v_chunk) expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          (SELECT structure FROM public.legal_documents WHERE id = v_document_id)
        ) actual
        WHERE actual->>'id' = expected->>'id'
          AND actual = expected
      )
    ) <> 0 THEN
      RAISE EXCEPTION 'Resolution 161 finalized document differs from batch ${batch}';
    END IF;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.legal_documents
    WHERE id = v_document_id
      AND COALESCE(metadata #> '{resolution_161_import,applied_batches}', '[]'::jsonb)
        ? '${batch}'
  ) THEN
    IF (
      SELECT count(*)
      FROM jsonb_array_elements(v_chunk) expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          (SELECT structure FROM public.legal_documents WHERE id = v_document_id)
        ) actual
        WHERE actual->>'id' = expected->>'id'
          AND actual = expected
      )
    ) <> 0 THEN
      RAISE EXCEPTION 'Resolution 161 batch ${batch} marker exists but content differs';
    END IF;
    RETURN;
  END IF;

  IF v_structure_length <> ${expectedStart} THEN
    RAISE EXCEPTION
      'Resolution 161 batch ${batch} expected structure length ${expectedStart}, got %',
      v_structure_length;
  END IF;

  UPDATE public.legal_documents
  SET
    structure = structure || v_chunk,
    metadata = jsonb_set(
      metadata,
      '{resolution_161_import,applied_batches}',
      COALESCE(metadata #> '{resolution_161_import,applied_batches}', '[]'::jsonb)
        || to_jsonb('${batch}'::text),
      true
    )
  WHERE id = v_document_id;

  IF jsonb_array_length(
    (SELECT structure FROM public.legal_documents WHERE id = v_document_id)
  ) <> ${expectedEnd} THEN
    RAISE EXCEPTION 'Resolution 161 batch ${batch} read-back failed';
  END IF;
END
$migration$;
`;
});

const finalMetadata = {
  ...metadata,
  resolution_161_import: {
    expected_nodes: nodes.length,
    expected_batches: chunks.length,
    state: "complete",
  },
};

const finalSql = `-- Atomically validate, publish and version the complete Resolution 161 import.
DO $migration$
DECLARE
  v_prompt_count integer;
  v_document_id uuid;
  v_content_text text;
  v_structure jsonb;
  v_chunk_count integer;
  v_metadata jsonb := ${dollar("metadata161", JSON.stringify(finalMetadata))}::jsonb;
BEGIN
  SELECT id, structure
  INTO v_document_id, v_structure
  FROM public.legal_documents
  WHERE external_id = 'w21124359'
  LIMIT 1;

  IF v_document_id IS NULL OR jsonb_array_length(v_structure) <> 2349 THEN
    RAISE EXCEPTION 'Resolution 161 finalization requires exactly 2349 nodes';
  END IF;

  IF (
    SELECT count(DISTINCT node->>'id') FROM jsonb_array_elements(v_structure) node
  ) <> 2349 OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_structure) node
    WHERE node->>'id' = 'code-70034'
  ) THEN
    RAISE EXCEPTION 'Resolution 161 node ids or code-70034 failed validation';
  END IF;

  SELECT string_agg(node.value->>'text', E'\\n\\n' ORDER BY node.ordinality)
  INTO v_content_text
  FROM jsonb_array_elements(v_structure) WITH ORDINALITY AS node(value, ordinality);

  UPDATE public.legal_documents
  SET
    source = 'etalon',
    source_url = 'https://etalonline.by/document/?regnum=w21124359',
    search_query = 'постановление 161 нормативные сроки службы основных средств',
    title = ${dollar("title161", title)},
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

  SELECT count(*)
  INTO v_chunk_count
  FROM public.legal_document_search_chunks
  WHERE document_id = v_document_id;
  IF v_chunk_count <> 2349 OR NOT EXISTS (
    SELECT 1 FROM public.legal_document_search_chunks
    WHERE document_id = v_document_id AND anchor = 'code-70034'
  ) THEN
    RAISE EXCEPTION
      'Resolution 161 search chunk read-back expected 2349 plus code-70034, got %',
      v_chunk_count;
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
    RAISE EXCEPTION 'asset_classifier prompt expected 1 row, got %', v_prompt_count;
  END IF;

  UPDATE public.legal_document_versions
  SET is_current = false
  WHERE document_id = v_document_id AND is_current;

  INSERT INTO public.legal_document_versions (
    document_id, revision_key, revision_label, effective_at, content_text,
    structure, checksum, source_url, is_current
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

const files = [
  ["20260730001500_asset_classifier_resolution_161_stage.sql", stageSql],
  ...batchSql.map((sql, index) => [
    `202607300015${String(index + 1).padStart(2, "0")}_asset_classifier_resolution_161_batch_${String(index + 1).padStart(2, "0")}.sql`,
    sql,
  ]),
  ["20260730001599_asset_classifier_resolution_161_finalize.sql", finalSql],
];

for (const [filename, sql] of files) {
  await writeFile(join(outputDirectory, filename), sql, "utf8");
}

console.log(
  `Generated ${files.length} managed migrations (${chunks.length} data batches) for ${nodes.length} nodes.`,
);
