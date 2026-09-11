import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function renderPilot(mode) {
  if (!['dry-run','execute'].includes(mode)) throw new Error('Explicit dry-run or execute mode required');
  const sql = readFileSync(new URL('./contact-merge-18-36.sql',import.meta.url),'utf8');
  const marker = '/* EXECUTE_FLAG */ false';
  if (sql.split(marker).length !== 2) throw new Error('Pilot execution marker changed');
  return sql.replace(marker, mode === 'execute' ? 'true' : 'false');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , mode, out] = process.argv;
  if (!out) throw new Error('Usage: node render-contact-merge-18-36.mjs <dry-run|execute> <output.sql>');
  const sql=renderPilot(mode);
  writeFileSync(out,sql,{mode:0o600});
  console.log(JSON.stringify({mode,sha256:createHash('sha256').update(sql).digest('hex')}));
}
