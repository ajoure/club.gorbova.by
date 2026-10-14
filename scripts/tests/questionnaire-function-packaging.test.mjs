import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
const root=resolve(import.meta.dirname,'../../supabase/functions');
// Lovable packages one function folder plus _shared, not sibling functions.
// Guard the newly introduced helper dependencies against this actual build boundary.
for(const name of ['process-scheduled-broadcasts','telegram-mass-broadcast']) test(`${name} includes its questionnaire helper in the managed function package`,async()=>{
  const entry=resolve(root,name,'index.ts');
  const code=await readFile(entry,'utf8');
  const imports=[...code.matchAll(/from ['"]([^'"]*questionnaire[^'"]*\.ts)['"]/g)].map(m=>m[1]);
  assert.equal(imports.length,1,'exactly one local questionnaire dependency');
  for(const specifier of imports){
    const target=resolve(dirname(entry),specifier);
    assert.ok(target.startsWith(resolve(root,name)+sep),'helper must ship inside this function package');
    const helper=await readFile(target,'utf8');
    assert.doesNotMatch(helper,/from ['"]\.\.\//,'helper has no sibling dependency');
  }
});

test('all three broadcast packages ship the same local button contract without changing shared bot release code', async()=>{
  const canonical=await readFile(resolve(root,'telegram-mass-broadcast/broadcastButtons.ts'),'utf8');
  for(const name of ['process-scheduled-broadcasts','telegram-send-test','telegram-mass-broadcast']) {
    const entry=await readFile(resolve(root,name,'index.ts'),'utf8');
    assert.match(entry,/from ['"]\.\/broadcastButtons\.ts['"]/);
    assert.equal(await readFile(resolve(root,name,'broadcastButtons.ts'),'utf8'),canonical);
  }
});
