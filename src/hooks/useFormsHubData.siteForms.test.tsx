import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
const mocks = vi.hoisted(() => ({ from: vi.fn(), forms: [] as any[], profiles: [] as any[] }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
import { DEFAULT_FILTERS, useFormsHubData } from './useFormsHubData';
function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  mocks.forms = [{id:'submission',form_data:{'Как вам удобно учиться?':'Онлайн'},metadata:{user_id:'account'},
    profile_id:'contact',order_id:'draft',created_at:'2026-10-09T10:00:00Z',status:'processed',site_pages:{title:'Предзапись'}}];
  mocks.profiles = [{id:'contact',user_id:'account',email:'test@example.invalid'}];
  mocks.from.mockImplementation((table:string) => {
    const result = table === 'site_form_submissions' ? {data:mocks.forms,count:1,error:null} : {data:mocks.profiles,error:null};
    const chain:any = {then:(resolve:any)=>Promise.resolve(result).then(resolve)};
    for (const method of ['select','order','range','in','gte','lte','not','is']) chain[method]=vi.fn(()=>chain);
    return chain;
  });
});
describe('site form contact email', () => {
  it('shows the linked contact email even when submission metadata already has user_id', async () => {
    const {result}=renderHook(()=>useFormsHubData({...DEFAULT_FILTERS,source_type:'site_form'}),{wrapper});
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows[0]).toMatchObject({client_email:'test@example.invalid',profile_id:'contact',user_id:'account',has_deal:true});
  });
  it('preserves the submitted address rather than replacing historical answers with current contact email', async () => {
    mocks.forms[0].form_data.email='original@example.invalid';
    const {result}=renderHook(()=>useFormsHubData({...DEFAULT_FILTERS,source_type:'site_form'}),{wrapper});
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows[0].client_email).toBe('original@example.invalid');
  });
  it('reads a custom email label through its saved mapping even without a profile email', async () => {
    mocks.forms[0].form_data={' Email для доступа к предложениям': ' entered@example.invalid '};
    mocks.forms[0].field_mapping={' Email для доступа к предложениям': 'email'};
    mocks.profiles=[];
    const {result}=renderHook(()=>useFormsHubData({...DEFAULT_FILTERS,source_type:'site_form'}),{wrapper});
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows[0].client_email).toBe('entered@example.invalid');
  });
  it('does not mistake an unrelated answer containing email wording for the email field', async () => {
    mocks.forms[0].form_data={'Email для предложений': 'entered@example.invalid', 'Комментарий email': 'другой ответ'};
    mocks.forms[0].field_mapping={'Email для предложений': 'email', 'Комментарий email':'none'};
    const {result}=renderHook(()=>useFormsHubData({...DEFAULT_FILTERS,source_type:'site_form'}),{wrapper});
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows[0].client_email).toBe('entered@example.invalid');
  });
});
