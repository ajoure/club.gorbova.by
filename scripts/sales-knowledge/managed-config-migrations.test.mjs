import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
for (const [source,migration] of [
 ['commercial-config','20260925205913_06c83e7c-79ec-4345-8d3e-7f7971bc64d0'],
 ['legacy-copy-offers','20260925210006_0c17ac05-bfbd-4f6c-bbdc-e567b19f698a'],
]) {
 test(`${source}: exact reviewed body and fail-closed transaction wrapper`,async()=>{
  const src=await readFile(new URL(`./cb21-${source}.sql`,import.meta.url),'utf8');
  const migrated=await readFile(new URL(`../../supabase/migrations/${migration}.sql`,import.meta.url),'utf8');
  const lines=migrated.split('\n');
  assert.equal(lines.slice(4).join('\n').trimEnd(),src.replace('\nBEGIN;\n','\n').replace(/COMMIT;\n$/,'').trimEnd());
  const db=new PGlite();
  try {
   await db.exec('BEGIN');
   await db.exec(lines[2]);
   await db.exec(lines[3]);
   await db.exec('ROLLBACK');
   await db.exec(lines[2]);
   await assert.rejects(db.exec(lines[3]),/cb21_not_single_transaction/);
  } finally {await db.close();}
 });
}
