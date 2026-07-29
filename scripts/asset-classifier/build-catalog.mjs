#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  throw new Error("Usage: node build-catalog.mjs <etalonline-export.json> <catalog-output.ts>");
}

const input = await readFile(inputPath, "utf8");
const source = JSON.parse(input);
const rows = Array.isArray(source.rows) ? source.rows : [];
const footnotes = Array.isArray(source.footnotes) ? source.footnotes : [];

const items = rows
  .filter((row) => /^\d{5}$/.test(row.code) && /^\d+(?:[.,]\d+)?$/.test(row.normative_life_years))
  .map((row) => ({
    sourceRow: row.source_row,
    name: row.name,
    code: row.code,
    normativeLifeYears: Number(String(row.normative_life_years).replace(",", ".")),
    footnoteMarkers: row.footnote_markers ?? [],
  }));

const hierarchy = rows
  .filter((row) => /^\d+$/.test(row.code) && !row.normative_life_years)
  .map((row) => ({
    sourceRow: row.source_row,
    name: row.name,
    code: row.code,
  }));

const duplicateCodes = items.length - new Set(items.map((item) => item.code)).size;
if (rows.length !== 2248) throw new Error(`Expected 2248 source rows, got ${rows.length}`);
if (items.length !== 1900) throw new Error(`Expected 1900 final positions, got ${items.length}`);
if (hierarchy.length !== 116) throw new Error(`Expected 116 hierarchy positions, got ${hierarchy.length}`);
if (footnotes.length !== 97) throw new Error(`Expected 97 footnotes, got ${footnotes.length}`);
if (duplicateCodes !== 0) throw new Error(`Expected unique final codes, got ${duplicateCodes} duplicates`);

const payload = {
  source: {
    ...source.source,
    url: "https://etalonline.by/document/?regnum=w21124359",
    extracted_at: "2026-07-29",
    normalized_source_sha256: createHash("sha256")
      .update(JSON.stringify({ rows, footnotes }))
      .digest("hex"),
  },
  stats: {
    sourceRows: rows.length,
    finalPositions: items.length,
    hierarchyPositions: hierarchy.length,
    footnotes: footnotes.length,
  },
  hierarchy,
  items,
  footnotes,
};

const output = [
  "// Generated from the authenticated ETALONLINE.BY consolidated text.",
  "// Do not edit manually. Rebuild with scripts/asset-classifier/build-catalog.mjs.",
  "export interface AssetClassifierCatalog {",
  "  source: { act_date: string; act_number: string; consolidated_revision: string; effective_from: string; regnum: string; title: string; url: string; extracted_at: string; normalized_source_sha256: string };",
  "  stats: { sourceRows: number; finalPositions: number; hierarchyPositions: number; footnotes: number };",
  "  hierarchy: Array<{ sourceRow: number; name: string; code: string }>;",
  "  items: Array<{ sourceRow: number; name: string; code: string; normativeLifeYears: number; footnoteMarkers: string[] }>;",
  "  footnotes: Array<{ marker: string; text: string }>;",
  "}",
  `export const ASSET_CLASSIFIER_CATALOG: AssetClassifierCatalog = ${JSON.stringify(payload, null, 2)};`,
  "",
].join("\n");

await writeFile(outputPath, output, "utf8");
