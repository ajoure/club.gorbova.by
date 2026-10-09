import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
const mocks=vi.hoisted(()=>({from:vi.fn(),profile:null as any,user:null as any,error:null as any,calls:[] as string[]}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:mocks.from}}));
import {useLinkedAdminContact} from './useLinkedAdminContact';
const id='11111111-1111-4111-8111-111111111111';
function wrapper({children}:PropsWithChildren){return <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{children}</QueryClientProvider>;}
beforeEach(()=>{
 mocks.calls=[];mocks.profile=null;mocks.user=null;mocks.error=null;
 mocks.from.mockImplementation(()=>{
   let key='';const chain:any={select:()=>chain,eq:(column:string)=>{if(column==='id'||column==='user_id'){key=column;mocks.calls.push(column);}return chain;},is:()=>chain,
    maybeSingle:()=>Promise.resolve({data:key==='id'?mocks.profile:mocks.user,error:mocks.error})};return chain;
 });
});
describe('direct contact links outside the loaded page',()=>{
 it('reads the exact profile without needing the contact list or user fallback',async()=>{
  mocks.profile={id,email:'test@example.invalid'};
  const {result}=renderHook(()=>useLinkedAdminContact(id),{wrapper});
  await waitFor(()=>expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.id).toBe(id);expect(mocks.calls).toEqual(['id']);
 });
 it('supports older account-id links with an unmerged active profile',async()=>{
  mocks.user={id:'canonical-contact',user_id:id};
  const {result}=renderHook(()=>useLinkedAdminContact(id),{wrapper});
  await waitFor(()=>expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.id).toBe('canonical-contact');expect(mocks.calls).toEqual(['id','user_id']);
 });
 it('does not turn a denied profile query into an alternate identity',async()=>{
  mocks.error=new Error('permission denied');
  const {result}=renderHook(()=>useLinkedAdminContact(id),{wrapper});
  await waitFor(()=>expect(result.current.isError).toBe(true));expect(mocks.calls).toEqual(['id']);
 });
});
