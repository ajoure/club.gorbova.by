import assert from 'node:assert/strict';
import test from 'node:test';
import {freshKnowledgeFacts} from '../../supabase/functions/_shared/sales-runtime/knowledge-freshness.mjs';

test('background and curriculum facts are both withheld when the source changes',()=>{
  const facts=[
    {id:'background',scope:'background',classification:'sales_safe',source_id:'s',source_revision:'old',source_sha256:'old-hash'},
    {id:'curriculum',scope:'curriculum',classification:'sales_safe',source_id:'s',source_revision:'new',source_sha256:'new-hash'},
    {id:'private',scope:'background',classification:'paid_private',source_id:'s',source_revision:'new',source_sha256:'new-hash'},
  ];
  assert.deepEqual(freshKnowledgeFacts(facts,[{source_id:'s',source_revision:'new',content_sha256:'new-hash'}]).map(f=>f.id),['curriculum']);
  assert.deepEqual(freshKnowledgeFacts(facts,[]),[]);
});
