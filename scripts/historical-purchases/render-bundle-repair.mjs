import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const md5 = /^[a-f0-9]{32}$/;
const ids = ['user_id', 'profile_id', 'history_order_id', 'ip_entitlement_id',
  'retail_entitlement_id', 'business_subscription_id', 'business_order_id', 'business_payment_id'];
const hashes = ['history_row_md5', 'history_snapshot_md5', 'history_meta_md5',
  'ip_row_md5', 'ip_meta_md5', 'dependency_md5'];

export function bundleDependencyExpression() {
  return readFileSync(new URL('./bundle-dependencies.sql', import.meta.url), 'utf8');
}

export function renderBundleRepair(input, mode) {
  if (!['dry-run', 'execute'].includes(mode) || !input || Array.isArray(input)) {
    throw new Error('One reviewed bundle and explicit dry-run/execute mode required');
  }
  const safe = {};
  for (const k of ids) {
    if (!uuid.test(input[k])) throw new Error(`Invalid UUID: ${k}`);
    safe[k] = input[k];
  }
  if (new Set(ids.map(k => safe[k])).size !== ids.length) throw new Error('Identity collision');
  for (const k of hashes) {
    if (!md5.test(input[k])) throw new Error(`Invalid observed hash: ${k}`);
    safe[k] = input[k];
  }
  for (const k of ['history_updated_at', 'ip_updated_at', 'business_end_at']) {
    if (typeof input[k] !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|\+00:00)$/.test(input[k])
      || !Number.isFinite(Date.parse(input[k]))) throw new Error(`Invalid UTC timestamp: ${k}`);
    safe[k] = input[k];
  }
  if (!/^[a-zA-Z0-9-]{12,90}$/.test(input.repair_key)) throw new Error('Invalid repair key');
  safe.repair_key = input.repair_key;
  if (!Array.isArray(input.proof_message_ids) || input.proof_message_ids.length < 2
      || input.proof_message_ids.length > 8 || input.proof_message_ids.some(v => !uuid.test(v))
      || new Set(input.proof_message_ids).size !== input.proof_message_ids.length) {
    throw new Error('Explicit unique proof message UUIDs required');
  }
  safe.proof_message_ids = input.proof_message_ids;
  let sql = readFileSync(new URL('./repair-bundle.sql', import.meta.url), 'utf8');
  for (const [marker, value] of [
    ["/* REVIEWED_INPUT */ '{}'::jsonb", `'${JSON.stringify(safe)}'::jsonb`],
    ['/* EXECUTE_FLAG */ false', mode === 'execute' ? 'true' : 'false'],
    ['/* TRANSACTION_MODE */ READ ONLY', mode === 'execute' ? 'READ WRITE' : 'READ ONLY'],
    ['/* DEPENDENCY_EXPRESSION */ NULL::text', `(${bundleDependencyExpression()})`],
  ]) {
    if (sql.split(marker).length !== 2) throw new Error('SQL marker changed');
    sql = sql.replace(marker, value);
  }
  return sql;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , inputPath, mode, outputPath] = process.argv;
  if (!outputPath) throw new Error('Usage: render-bundle-repair.mjs private-input.json dry-run|execute output.sql');
  const sql = renderBundleRepair(JSON.parse(readFileSync(inputPath, 'utf8')), mode);
  writeFileSync(outputPath, sql, { mode: 0o600 });
  console.log(JSON.stringify({ mode, sha256: createHash('sha256').update(sql).digest('hex') }));
}
