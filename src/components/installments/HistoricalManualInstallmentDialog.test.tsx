import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { describe,it,expect,vi,beforeEach } from 'vitest';
import { HistoricalManualInstallmentDialog } from './HistoricalManualInstallmentDialog';
const state=vi.hoisted(()=>({invoke:vi.fn(),edit:true,rows:[{id:'order',order_number:'EXISTING',final_price:1325,paid_amount:1325,
  products_v2:{name:'Course'},payments_v2:[{id:'receipt',status:'succeeded',amount:1325,is_deleted:false}]}]}));
vi.mock('@/utils/invokeAuthenticatedFunction',()=>({invokeAuthenticatedFunction:state.invoke}));
vi.mock('@/hooks/useAdminAccess',()=>({useAdminAccess:()=>({canAccessSection:()=>state.edit})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
  const q={select:()=>q,eq:()=>q,in:()=>q,gt:()=>q,order:async()=>({data:state.rows,error:null})};return q;
}}}));
function show(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
  <HistoricalManualInstallmentDialog profileId="profile" userId="buyer"/>
</QueryClientProvider>);}
beforeEach(()=>{state.edit=true;state.invoke.mockReset();});
describe('native historical agreement review',()=>{
  it('hides financial action from a non-edit staff member',()=>{state.edit=false;show();expect(screen.queryByRole('button')).toBeNull();});
  it('requires a preview before confirmation and sends only selected existing purchase/receipt',async()=>{
    state.invoke.mockResolvedValueOnce({data:{success:true,confirmed:false,fingerprint:'server-checked',total_byn:2650,paid_byn:1325,remaining_byn:1325,
      second_due_at:'2026-08-14T10:00:00Z'},error:null});
    show();fireEvent.click(screen.getByRole('button',{name:'Оформить историческую рассрочку'}));
    await waitFor(()=>expect(screen.getByRole('option',{name:/EXISTING/})).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Исходная сделка'),{target:{value:'order'}});
    fireEvent.change(screen.getByLabelText('Решение владельца и основание'),{target:{value:'Confirmed original two-part agreement'}});
    expect(screen.queryByRole('button',{name:'Подтвердить условия'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Проверить расчёт'}));
    await screen.findByRole('button',{name:'Подтвердить условия'});
    expect(state.invoke).toHaveBeenCalledTimes(1);expect(state.invoke.mock.calls[0][1]).toMatchObject({action:'preview',profile_id:'profile',
      order_id:'order',first_payment_id:'receipt',total_byn:2650,interval_days:0});
    state.invoke.mockResolvedValueOnce({data:{success:true,confirmed:true,total_byn:2650,paid_byn:1325,remaining_byn:1325,second_due_at:'2026-08-14T10:00:00Z'},error:null});
    fireEvent.click(screen.getByRole('button',{name:'Подтвердить условия'}));
    await screen.findByRole('button',{name:'Проверить доступ по первому взносу'});
    expect(state.invoke).toHaveBeenCalledTimes(2);expect(state.invoke.mock.calls[1][1]).toMatchObject({action:'confirm',fingerprint:'server-checked',order_id:'order'});
    expect(state.invoke.mock.calls[1][1].request_id).toBe(state.invoke.mock.calls[0][1].request_id);
  });
});
