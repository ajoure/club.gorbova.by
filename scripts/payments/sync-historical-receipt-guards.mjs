// Managed Lovable deploys contain the function directory and _shared only.
// Keep the canonical guard's package-local mirrors identical without changing
// unrelated shared/CB21 release code. Default: check; --write: regenerate.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../../supabase/functions');
const pairs = [
  ...['payments-reconcile', 'grant-access-for-order', 'bepaid-archive-import', 'admin-materialize-post-cancel-charge',
    'bepaid-get-subscription-details', 'bepaid-fetch-transactions', 'admin-bepaid-full-reconcile', 'bepaid-uid-resync']
    .map(name => ['bepaid-webhook/historical-receipt-guard.ts', `${name}/historical-receipt-guard.ts`]),
  ...['bepaid-fetch-transactions', 'admin-bepaid-full-reconcile', 'bepaid-uid-resync']
    .map(name => ['bepaid-get-subscription-details/receipt-sync-policy.ts', `${name}/receipt-sync-policy.ts`]),
  ['bepaid-webhook/historical-rebill-flow.ts', 'admin-materialize-post-cancel-charge/historical-rebill-flow.ts'],
];
let mismatches = 0;
for (const [source, target] of pairs) {
  const canonical = await readFile(resolve(root, source), 'utf8');
  if (process.argv.includes('--write')) await writeFile(resolve(root, target), canonical);
  if (await readFile(resolve(root, target), 'utf8') !== canonical) {
    console.error(`Guard mirror differs: ${target}`); mismatches++;
  }
}
if (mismatches) process.exitCode = 1;
else console.log(`Historical receipt guard: ${pairs.length} package mirrors match.`);
