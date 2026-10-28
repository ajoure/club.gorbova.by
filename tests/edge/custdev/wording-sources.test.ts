import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { emptyAnalysis, emptyState, needScores, type Need, type Sources } from '../../../supabase/functions/_shared/custdev-contract';
import { hashesFor, validateAiOutput } from '../../../supabase/functions/_shared/custdev-workspace';
import { wordingSourceRequest } from '../../../supabase/functions/training-custdev/wording-sources';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
async function fixture() {
  const state = emptyState();
  state.segments = ['s1', 's2', 'archived'].map(id => ({id,title:id,description:'',decisionMaker:'',reason:'',productTypeIds:[],questions:[],archived:id==='archived'}));
  const sources: Sources = {portfolio:[],products:[{id:'product-1',name:'Календарь',description:'',kind:'service'}],context:{},lessons:[],warnings:[]};
  const hashes = await hashesFor(state, sources);
  for (const segment of state.segments) {
    state.analyses[segment.id] = {...emptyAnalysis(), sourceHash:hashes[segment.id]};
    const need: Need = {id:`need-${segment.id}`,label:`Потребность ${segment.id}`,category:'problem',quoteIds:[],aiOriginal:null,overrides:{},approvedValue:null,excluded:false,priority:false};
    need.approvedValue = {...needScores(state,segment.id,need),sourceHash:hashes[segment.id]};
    state.analyses[segment.id].needs.push(need);
  }
  return {state,sources,hashes};
}
const metadata = (prompt:string) => JSON.parse(prompt.split('\n').at(-1)!);
const proposal = (refs:unknown[]) => ({text:'Гипотеза по проверенным потребностям',used_sources:refs,missing_evidence:['Проверить механизм']});

describe('request-local wording source references', () => {
  it.each(['quotes','needs'] as const)('does not alter %s prompts or outputs',async action => {
    const f=await fixture(),output={items:[]};
    const request=wordingSourceRequest('base',action,'s1',f.state,f.sources,f.hashes);
    expect(request.prompt).toBe('base');expect(request.decode(output)).toBe(output);
  });
  it('lists only current approved sources of active segments, with explicit string enums',async()=>{
    const f=await fixture();
    const excluded={...f.state.analyses.s1.needs[0],id:'excluded',excluded:true};
    const stale={...f.state.analyses.s1.needs[0],id:'stale',approvedValue:{...excluded.approvedValue!,sourceHash:'old'}};
    f.state.analyses.s1.needs.push(excluded,stale);
    const request=wordingSourceRequest('base','company',null,f.state,f.sources,f.hashes),m=metadata(request.prompt);
    expect(m.references.map((r:{label:string})=>r.label)).toEqual(['Потребность s1','Потребность s2','Календарь']);
    expect(m.response_schema.properties.used_sources.items).toEqual({type:'string',enum:m.references.map((r:{ref:string})=>r.ref)});
    expect(request.prompt).toContain('не названия, не объекты, не ID цитат или сегментов');
    const decoded=request.decode(proposal(m.references.map((r:{ref:string})=>r.ref)));
    const result=await validateAiOutput(decoded,f.state,f.sources,'company',null);
    expect(result).toMatchObject({used_sources:['need-s1','need-s2','product-1']});
  });
  it.each(['positioning','usp'] as const)('does not broaden the %s segment scope',async action=>{
    const f=await fixture();
    if(action==='usp') f.state.usps=[{id:'u1',segmentId:'s1',title:'',needId:null,problem:'',result:'',mechanism:'',productRefs:[],evidence:'',userText:'',aiText:'',approvedText:'',status:'draft'}];
    const request=wordingSourceRequest('base',action,'s1',f.state,f.sources,f.hashes),m=metadata(request.prompt);
    expect(m.references.map((r:{label:string})=>r.label)).toEqual(['Потребность s1','Календарь']);
    const result=await validateAiOutput(request.decode(proposal([m.references[0].ref])),f.state,f.sources,action,'s1',action==='usp'?'u1':null);
    expect(result).toMatchObject({used_sources:['need-s1']});
    await expect(validateAiOutput(request.decode(proposal(['need-s2'])),f.state,f.sources,action,'s1',action==='usp'?'u1':null)).rejects.toThrow(/неподтверждённые/);
  });
  it.each([[],['unknown'],['quote-1'],['Потребность s1'],[{ref:'CUSTDEV_SOURCE_1'}],[1],['CUSTDEV_SOURCE_1','unknown']].map(refs=>({refs})))('retains rejection of malformed or unlisted sources: $refs',async({refs})=>{
    const f=await fixture(),request=wordingSourceRequest('base','company',null,f.state,f.sources,f.hashes);
    await expect(validateAiOutput(request.decode(proposal(refs)),f.state,f.sources,'company',null)).rejects.toThrow(/неподтверждённые/);
  });
  it('keeps the canonical validator, leaves caller data immutable and accepts exact canonical references',async()=>{
    const f=await fixture(),request=wordingSourceRequest('base','company',null,f.state,f.sources,f.hashes);
    const raw=Object.freeze({...proposal(['CUSTDEV_SOURCE_1']),used_sources:Object.freeze(['CUSTDEV_SOURCE_1'])});
    expect(request.decode(raw)).toMatchObject({used_sources:['need-s1']});
    expect(raw.used_sources).toEqual(['CUSTDEV_SOURCE_1']);
    const result=await validateAiOutput(request.decode(proposal(['need-s1'])),f.state,f.sources,'company',null);
    expect(result).toMatchObject({used_sources:['need-s1']});
  });
  it('redacts reference labels and does not append canonical IDs, even numeric ones',async()=>{
    const f=await fixture();f.state.analyses.s1.needs[0].id='123456789012';
    f.state.analyses.s1.needs[0].label='Контакт test@example.com, +375291234567';
    const request=wordingSourceRequest('base','company',null,f.state,f.sources,f.hashes);
    expect(request.prompt).not.toContain('123456789012');expect(request.prompt).not.toContain('test@example.com');expect(request.prompt).not.toContain('+375291234567');
    expect(request.prompt).toContain('[email]');expect(request.prompt).toContain('[телефон]');
    expect(request.decode(proposal(['CUSTDEV_SOURCE_1']))).toMatchObject({used_sources:['123456789012']});
  });
  it('avoids collisions between aliases and canonical source IDs',async()=>{
    const f=await fixture();f.state.analyses.s1.needs[0].id='CUSTDEV_SOURCE_1';
    const request=wordingSourceRequest('base','company',null,f.state,f.sources,f.hashes),m=metadata(request.prompt);
    expect(m.references[0].ref).toBe('CUSTDEV_SOURCE_2');
    expect(request.decode(proposal(['CUSTDEV_SOURCE_2']))).toMatchObject({used_sources:['CUSTDEV_SOURCE_1']});
  });
  it('omits a whole analysis when its source hash has become stale',async()=>{
    const f=await fixture();f.state.analyses.s1.sourceHash='old';
    const m=metadata(wordingSourceRequest('base','company',null,f.state,f.sources,f.hashes).prompt);
    expect(m.references.map((r:{label:string})=>r.label)).toEqual(['Потребность s2','Календарь']);
  });
  it('bounds the extra reference label without changing the author source',async()=>{
    const f=await fixture();f.state.analyses.s1.needs[0].label='я'.repeat(1000);
    const m=metadata(wordingSourceRequest('base','company',null,f.state,f.sources,f.hashes).prompt);
    expect(m.references[0].label).toHaveLength(240);expect(f.state.analyses.s1.needs[0].label).toHaveLength(1000);
  });
});
