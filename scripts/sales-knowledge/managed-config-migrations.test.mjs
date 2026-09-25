import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
for (const [source,migration] of [
 ['commercial-config','20260926001000_cb21_accountant_source_parity'],
 ['legacy-copy-offers','20260926001100_cb21_legacy_copy_offer_guard'],
]) {
 test(`${source}: exact reviewed body and fail-closed transaction wrapper`,async()=>{
  const src=await readFile(new URL(`./cb21-${source}.sql`,import.meta.url),'utf8');
  const migrated=await readFile(new URL(`../../supabase/migrations/${migration}.sql`,import.meta.url),'utf8');
  const lines=migrated.split('\n');
  assert.equal(lines.slice(4).join('\n'),src.replace('\nBEGIN;\n','\n').replace(/COMMIT;\n$/,''));
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
