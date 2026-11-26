import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { PaymentReallocationDialog } from './PaymentReallocationDialog';
const mock=vi.hoisted(()=>({rpc:vi.fn(),admin:true}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
vi.mock('@/hooks/useAdminAccess',()=>({useAdminAccess:()=>({isAdmin:mock.admin,isSuperAdmin:false})}));
const preview={before_hash:'synthetic_hash',source_new_end:'2030-01-10T12:00:00Z',target_old_end:'2029-12-26T20:59:59Z',target_new_end:'2030-01-25T20:59:59Z'};
const show=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PaymentReallocationDialog profileId="synthetic-profile" paymentId="synthetic-payment"/></QueryClientProvider>);
beforeEach(()=>{mock.admin=true;mock.rpc.mockReset();localStorage.clear();});afterEach(cleanup);
describe('native payment correction confirmation',()=>{
  it('does not show the action to non-admin staff',()=>{mock.admin=false;show();expect(screen.queryByRole('button')).toBeNull();expect(mock.rpc).not.toHaveBeenCalled();});
  it('reads preview and requires reason before the one explicit commit',async()=>{
    mock.rpc.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:preview,error:null}).mockResolvedValueOnce({data:{...preview,applied:true},error:null});show();
    fireEvent.click(screen.getByText('Исправить продукт оплаты'));
    await screen.findByText(/Клуб останется оплачен/);
    expect(mock.rpc.mock.calls.map(c=>c[0])).toEqual(['admin_get_payment_reallocation','admin_preview_payment_reallocation']);
    expect(screen.getByText('Подтвердить перенос 250 BYN')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Причина переноса'),{target:{value:'Agreed mistaken product correction'}});
    fireEvent.click(screen.getByText('Подтвердить перенос 250 BYN'));
    await screen.findByRole('status');
    expect(mock.rpc.mock.calls[2][1]).toMatchObject({p_payment_id:'synthetic-payment',p_profile_id:'synthetic-profile',p_before_hash:'synthetic_hash',p_reason:'Agreed mistaken product correction'});
    expect(mock.rpc.mock.calls.filter(c=>c[0]==='admin_commit_payment_reallocation')).toHaveLength(1);
  });
  it('unknown outcome survives reopen and never resends; only reads the same receipt result',async()=>{
    mock.rpc.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:preview,error:null}).mockRejectedValueOnce(new Error('transport interrupted'));
    show();fireEvent.click(screen.getByText('Исправить продукт оплаты'));await screen.findByText(/Клуб останется оплачен/);
    fireEvent.change(screen.getByLabelText('Причина переноса'),{target:{value:'Agreed mistaken product correction'}});fireEvent.click(screen.getByText('Подтвердить перенос 250 BYN'));
    await screen.findByRole('alert');expect(localStorage.getItem('payment-reallocation:synthetic-profile:synthetic-payment')).toBeTruthy();
    cleanup();mock.rpc.mockResolvedValueOnce({data:null,error:null});show();fireEvent.click(screen.getByText('Исправить продукт оплаты'));
    await screen.findByText(/Результат ещё не подтверждён/);
    expect(mock.rpc.mock.calls.filter(c=>c[0]==='admin_commit_payment_reallocation')).toHaveLength(1);
    expect(mock.rpc.mock.calls.filter(c=>c[0]==='admin_preview_payment_reallocation')).toHaveLength(1);
    mock.rpc.mockResolvedValueOnce({data:{...preview,applied:true},error:null});fireEvent.click(screen.getByText('Проверить результат'));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Перенос подтверждён'));
  });
});
