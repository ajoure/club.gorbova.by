#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const [migrationDirectory = "supabase/migrations"] = process.argv.slice(2);
const filenames = (await readdir(migrationDirectory))
  .filter((name) => /^202607300015\d{2}_asset_classifier_resolution_161_/.test(name))
  .sort();

if (filenames.length !== 14) {
  throw new Error(`Expected 14 managed migrations, got ${filenames.length}`);
}

const stageName = filenames[0];
const finalName = filenames.at(-1);
const batchNames = filenames.slice(1, -1);
if (!stageName.endsWith("_stage.sql") || !finalName.endsWith("_finalize.sql")) {
  throw new Error("Managed migration series must start with stage and end with finalize");
}
if (batchNames.length !== 12) {
  throw new Error(`Expected 12 data batches, got ${batchNames.length}`);
}

const nodes = [];
for (const [index, name] of batchNames.entries()) {
  const path = join(migrationDirectory, name);
  const size = (await stat(path)).size;
  if (size > 70_000) {
    throw new Error(`${name} exceeds the 70 KB managed-channel safety limit`);
  }

  const sql = await readFile(path, "utf8");
  const batch = String(index + 1).padStart(2, "0");
  const marker = `$batch161_${batch}$`;
  const parts = sql.split(marker);
  if (parts.length !== 3) {
    throw new Error(`${name} does not contain batch payload ${batch}`);
  }
  nodes.push(...JSON.parse(parts[1]));
}

if (nodes.length !== 2349) {
  throw new Error(`Expected 2349 nodes, got ${nodes.length}`);
}
if (new Set(nodes.map((node) => node.id)).size !== nodes.length) {
  throw new Error("Managed migration nodes must have unique anchors");
}
if (!nodes.some((node) => node.id === "code-70034")) {
  throw new Error("Managed migration nodes do not contain code-70034");
}

const stageSql = await readFile(join(migrationDirectory, stageName), "utf8");
const finalSql = await readFile(join(migrationDirectory, finalName), "utf8");
for (const required of [
  "v_metadata,\n      false",
  "resolution_161_import",
  "expected_batches",
]) {
  if (!stageSql.includes(required)) {
    throw new Error(`Stage migration is missing invariant: ${required}`);
  }
}
for (const required of [
  "is_published = true",
  "code-70034",
  "v_chunk_count <> 2349",
  "v_prompt_count <> 1",
  "2017-04-10-etalon-w21124359",
]) {
  if (!finalSql.includes(required)) {
    throw new Error(`Finalize migration is missing invariant: ${required}`);
  }
}

console.log(
  `PASS: ${filenames.length} managed migrations, ${nodes.length} unique nodes, code-70034 present.`,
);
