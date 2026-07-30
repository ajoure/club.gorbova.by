#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const [
  migrationDirectory = "supabase/migrations",
  batchDirectory = "scripts/asset-classifier/resolution-161-import",
] = process.argv.slice(2);

const migrations = (await readdir(migrationDirectory))
  .filter((name) =>
    /^2026073000200[01]_asset_classifier_resolution_161_/.test(name)
  )
  .sort();
const batches = (await readdir(batchDirectory))
  .filter((name) => /^resolution_161_batch_\d{2}\.sql$/.test(name))
  .sort();

if (migrations.length !== 2) {
  throw new Error(`Expected 2 managed migrations, got ${migrations.length}`);
}
if (batches.length !== 12) {
  throw new Error(`Expected 12 sandbox INSERT batches, got ${batches.length}`);
}

const setupSql = await readFile(join(migrationDirectory, migrations[0]), "utf8");
const finalSql = await readFile(join(migrationDirectory, migrations[1]), "utf8");
for (const required of [
  "CREATE SCHEMA IF NOT EXISTS asset_classifier_import",
  "ENABLE ROW LEVEL SECURITY",
  "GRANT SELECT, INSERT",
  "CREATE POLICY sandbox_resolution_161_select",
  "CREATE POLICY sandbox_resolution_161_insert",
]) {
  if (!setupSql.includes(required)) {
    throw new Error(`Import-buffer migration is missing invariant: ${required}`);
  }
}
if (setupSql.includes("GRANT UPDATE") || setupSql.includes("GRANT DELETE")) {
  throw new Error("Import-buffer migration must not grant UPDATE or DELETE");
}

const nodes = [];
for (const [index, name] of batches.entries()) {
  const path = join(batchDirectory, name);
  const size = (await stat(path)).size;
  if (size > 70_000) {
    throw new Error(`${name} exceeds the 70 KB batch safety limit`);
  }
  const batch = String(index + 1).padStart(2, "0");
  const marker = `$batch161_${batch}$`;
  const parts = (await readFile(path, "utf8")).split(marker);
  if (parts.length !== 3) {
    throw new Error(`${name} does not contain batch payload ${batch}`);
  }
  nodes.push(...JSON.parse(parts[1]));
}

if (nodes.length !== 2349) {
  throw new Error(`Expected 2349 nodes, got ${nodes.length}`);
}
if (new Set(nodes.map((node) => node.id)).size !== nodes.length) {
  throw new Error("Import batches must have unique anchors");
}
if (!nodes.some((node) => node.id === "code-70034")) {
  throw new Error("Import batches do not contain code-70034");
}

for (const required of [
  "jsonb_array_length(v_structure) <> 2349",
  "count(DISTINCT node->>'id')",
  "anchor = 'code-70034'",
  "v_chunk_count <> 2349",
  "v_prompt_count <> 1",
  "2017-04-10-etalon-w21124359",
  "is_published = true",
  "DROP SCHEMA asset_classifier_import CASCADE",
]) {
  if (!finalSql.includes(required)) {
    throw new Error(`Finalize migration is missing invariant: ${required}`);
  }
}

console.log(
  `PASS: 2 managed migrations, ${batches.length} INSERT batches, ${nodes.length} unique nodes, code-70034 present.`,
);
