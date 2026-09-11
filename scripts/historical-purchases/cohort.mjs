import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SOURCE_ID = '1dw8ljnBwfyNn26INHdwxt7MdRGs7aX5qkby7V1wWUq8';
const DUPLICATE_GROUPS = [['18:14', '18:53'], ['18:15', '18:39'], ['18:17', '18:54']];
const HASH = /^[a-f0-9]{64}$/;

export function resolveHistoricalTariff(title, catalog) {
  if (!title || title.startsWith('Вид деятельности:')) return null;
  const base = title.split(',')[0].replace(/"/g, '').trim();
  const match = base.match(/^ЦЕННЫЙ БУХГАЛТЕР 2\.0(?: 18 поток)? тариф (.+)$/u);
  if (!match) throw new Error('Unrecognised historical course title');
  const name = catalog.legacy_tariff_aliases[match[1]] || catalog.legacy_tariff_aliases[`тариф ${match[1]}`] || match[1];
  const id = catalog.tariffs[name];
  if (!id) throw new Error('Unconfirmed historical tariff alias');
  return id;
}

/** No database writes or access grants. Names in title/J/K never add modules. */
export function buildSourceCohort(manifest, catalog) {
  if (manifest.source_spreadsheet_id !== SOURCE_ID || manifest.confirmed_paid_by_owner !== true) {
    throw new Error('Unapproved source or payment assumption');
  }
  if (!catalog.legacy_tariff_alias_mapping_verified) throw new Error('Tariff mapping not confirmed');
  if (manifest.rows.length !== 141) throw new Error('Source row count changed');
  const byRef = new Map();
  for (const row of manifest.rows) {
    const match = row.ref.match(/^(17|18):(\d+)$/);
    const cohort = Number(match?.[1]), number = Number(match?.[2]);
    if (!match || number < 2 || number > (cohort === 17 ? 88 : 55) || byRef.has(row.ref)) {
      throw new Error('Unexpected or duplicate source row reference');
    }
    if (!HASH.test(row.email_sha256) || (row.phone_sha256 !== null && !HASH.test(row.phone_sha256))) {
      throw new Error('Invalid normalized identity hash');
    }
    if (!Array.isArray(row.module_flags) || row.module_flags.some(n => !Number.isInteger(n) || n < 0 || n > 7)
        || new Set(row.module_flags).size !== row.module_flags.length) {
      throw new Error('Invalid module flags');
    }
    const tariffId = resolveHistoricalTariff(row.title, catalog);
    byRef.set(row.ref, {
      refs: [row.ref], cohort, email_sha256: row.email_sha256, phone_sha256: row.phone_sha256,
      product_id: tariffId ? catalog.course_product_id : null,
      tariff_id: tariffId,
      flow_id: tariffId && cohort === 18 ? catalog.flow_18_id : null,
      module_product_ids: row.module_flags.map(n => catalog.module_product_ids_in_sheet_column_order[n]),
    });
  }
  for (const refs of DUPLICATE_GROUPS) {
    const [first, second] = refs.map(ref => byRef.get(ref));
    if (!first || !second || first.email_sha256 !== second.email_sha256
        || first.phone_sha256 !== second.phone_sha256 || first.tariff_id !== second.tariff_id) {
      throw new Error('Previously confirmed duplicate group changed');
    }
    first.refs.push(...second.refs);
    first.module_product_ids = [...new Set([...first.module_product_ids, ...second.module_product_ids])];
    byRef.delete(refs[1]);
  }
  const cohort = [...byRef.values()];
  if (cohort.length !== 138) throw new Error('Deduplicated cohort count changed');
  for (const row of cohort) {
    if ([row.product_id, ...row.module_product_ids].some(id => catalog.excluded_product_ids.includes(id))) {
      throw new Error('New course cohort must not receive historical purchases');
    }
  }
  return cohort;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , sourcePath, catalogPath] = process.argv;
  if (!sourcePath || !catalogPath) throw new Error('Usage: node cohort.mjs <private-hash-manifest.json> <catalog.json>');
  const rows = buildSourceCohort(JSON.parse(readFileSync(sourcePath, 'utf8')), JSON.parse(readFileSync(catalogPath, 'utf8')));
  console.log(JSON.stringify({ source_rows: rows.reduce((n, r) => n + r.refs.length, 0),
    cohort_rows: rows.length, course_purchase_facts: rows.filter(r => r.product_id).length,
    module_purchase_facts: rows.reduce((n, r) => n + r.module_product_ids.length, 0),
    module_only_refs: rows.filter(r => !r.product_id).map(r => r.refs) }, null, 2));
}
