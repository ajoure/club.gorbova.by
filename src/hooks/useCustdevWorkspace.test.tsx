import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState, type CustdevState } from '../../supabase/functions/_shared/custdev-contract';
const {invoke}=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke}}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'learner'}})}));
import { useCustdevWorkspace } from './useCustdevWorkspace';
const loaded=(state=emptyState(),revision=0)=>({workspace:revision?{id:'workspace',revision,status:'draft'}:null,state,hashes:{},sources:{portfolio:[],products:[],context:{},lessons:[],warnings:[]},canEdit:true,isAdmin:false,runs:[],versions:[]});
const saved=(body:any)=>({data:loaded(body.state,body.expectedRevision+1),error:null});
const start=async(review=false)=>{const hook=renderHook(()=>useCustdevWorkspace('lesson','block',undefined,review));await act(async()=>{});return hook;};
beforeEach(()=>{invoke.mockReset();localStorage.clear();invoke.mockImplementation(async(_name,{body})=>body.action==='load'?{data:loaded(),error:null}:saved(body));});
describe('custdev autosave',()=>{
 it('serializes pending saves and keeps text typed while the first response is delayed',async()=>{
  let resolveFirst:(value:any)=>void=()=>{},saveNumber=0;const writes:any[]=[];
  invoke.mockImplementation(async(_name,{body})=>{if(body.action==='load')return {data:loaded(),error:null};writes.push(body);if(++saveNumber===1)return new Promise(resolve=>{resolveFirst=resolve;});return saved(body);});
  const {result,unmount}=await start();let flushing:Promise<void>;
  act(()=>result.current.edit(s=>{s.company.userText='Первый';}));
  await act(async()=>{flushing=result.current.flush();await Promise.resolve();});
  act(()=>result.current.edit(s=>{s.company.userText='Второй';}));
  await act(async()=>{resolveFirst(saved(writes[0]));await flushing;});
  expect(writes.map(w=>[w.expectedRevision,w.state.company.userText])).toEqual([[0,'Первый'],[1,'Второй']]);expect(result.current.getState().company.userText).toBe('Второй');expect(result.current.workspace?.revision).toBe(2);expect(localStorage.length).toBe(0);unmount();
 });
 it('retains the local draft on failure and offers it after reload',async()=>{
  const {result,unmount}=await start();act(()=>result.current.edit(s=>{s.company.userText='Несохранённое';}));
  invoke.mockResolvedValueOnce({error:new Error('offline'),data:null});
  await act(async()=>{await expect(result.current.flush()).rejects.toThrow(/черновике/);});
  expect(result.current.saveStatus).toBe('error');expect(JSON.parse(localStorage.getItem('custdev:v1:learner:learner:block')!).state.company.userText).toBe('Несохранённое');
  await act(async()=>{await result.current.reload();});expect(result.current.state.company.userText).toBe('');expect(result.current.draft?.company.userText).toBe('Несохранённое');
  act(()=>result.current.restoreDraft());await act(async()=>{await result.current.flush();});expect(result.current.state.company.userText).toBe('Несохранённое');unmount();
 });
 it('blocks overwrite after a revision conflict until explicit comparison/reload',async()=>{
  const {result,unmount}=await start();act(()=>result.current.edit(s=>{s.company.userText='Локально';}));
  invoke.mockResolvedValueOnce({data:{error:'Изменено в другой вкладке'},error:null});
  await act(async()=>{await expect(result.current.flush()).rejects.toThrow(/вкладке/);});expect(result.current.conflict).toBe(true);
  act(()=>result.current.edit(s=>{s.company.userText='Не должен перезаписать';}));expect(result.current.getState().company.userText).toBe('Локально');unmount();
 });
 it('admin review never edits or autosaves the student document',async()=>{const {result,unmount}=await start(true);expect(result.current.canEdit).toBe(false);act(()=>result.current.edit(s=>{s.company.userText='Подмена';}));await act(async()=>{await result.current.flush();});expect(result.current.state.company.userText).toBe('');expect(invoke).toHaveBeenCalledTimes(1);unmount();});
});
