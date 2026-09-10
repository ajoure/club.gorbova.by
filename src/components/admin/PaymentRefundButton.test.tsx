import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PaymentRefundButton } from './PaymentRefundButton';
const mocks = vi.hoisted(() => ({ invoke:vi.fn(), loading:false, data:[] as any[] }));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
vi.mock('@tanstack/react-query',()=>({useQuery:()=>({data:mocks.data,isLoading:mocks.loading,error:null})}));
const payments = ['first','second','third'].map((id,i)=>({id,order_id:'order',status:'succeeded',provider:'bepaid',provider_payment_id:`uid-${id}`,amount:663,refunded_amount:0,currency:'BYN',paid_at:`2026-09-${String(i+1).padStart(2,'0')}T12:00:00Z`}));
beforeEach(()=>{mocks.data=payments;mocks.loading=false;mocks.invoke.mockReset();mocks.invoke.mockResolvedValue({data:{success:true},error:null});});
describe('per-payment refund reuses the canonical dialog',()=>{
  it('submits the third payment and keeps access, never the first payment',async()=>{
    render(<PaymentRefundButton payment={payments[2]} orderNumber="SYNTHETIC"/>);
    fireEvent.click(screen.getByRole('button',{name:'Возврат'}));
    expect((screen.getByLabelText('Платёж для возврата') as HTMLSelectElement).value).toBe('third');
    expect(screen.getByLabelText('Платёж для возврата')).toBeDisabled();
    expect(screen.getByTestId('refund-access-action-keep')).toHaveAttribute('data-selected','true');
    expect(screen.getByRole('radio',{name:/Аннулировать доступ/})).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Причина возврата/),{target:{value:'Synthetic test'}});
    fireEvent.click(screen.getByRole('button',{name:/Вернуть/}));
    await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.invoke.mock.calls[0][0]).toBe('subscription-admin-actions');
    expect(mocks.invoke.mock.calls[0][1].body).toMatchObject({payment_id:'third',order_id:'order',refund_amount:663,access_action:'keep'});
    expect(mocks.invoke.mock.calls[0][1].body.refund_request_key).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('checks the exact payment and subscriptions without issuing a refund',async()=>{
    mocks.invoke.mockResolvedValue({data:{success:true,checked_at:new Date().toISOString(),transaction:{matches_payment:true,status:'successful',http:200},subscriptions:[{id:'sbs_synthetic',status:'completed',http:200}],all_subscriptions_terminal:true},error:null});
    render(<PaymentRefundButton payment={payments[2]} orderNumber="SYNTHETIC"/>);
    fireEvent.click(screen.getByRole('button',{name:'Возврат'}));
    fireEvent.click(screen.getByRole('button',{name:'Проверить в bePaid'}));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Все найденные подписки завершены'));
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('subscription-admin-actions',{body:{action:'refund_preflight',payment_id:'third',order_id:'order'}});
  });
  it('does not submit more than the payment remainder',async()=>{
    render(<PaymentRefundButton payment={payments[2]} orderNumber="SYNTHETIC"/>);
    fireEvent.click(screen.getByRole('button',{name:'Возврат'}));
    fireEvent.change(screen.getByLabelText(/Причина возврата/),{target:{value:'Synthetic test'}});
    fireEvent.change(screen.getByLabelText('Сумма возврата'),{target:{value:'664'}});
    fireEvent.click(screen.getByRole('button',{name:/Вернуть/}));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('waits for a fresh payment read before enabling the action',()=>{
    mocks.loading=true;mocks.data=undefined as any;
    render(<PaymentRefundButton payment={payments[2]} orderNumber="SYNTHETIC"/>);
    fireEvent.click(screen.getByRole('button',{name:'Возврат'}));
    fireEvent.change(screen.getByLabelText(/Причина возврата/),{target:{value:'Synthetic test'}});
    expect(screen.getByRole('button',{name:/Вернуть/})).toBeDisabled();
  });
  it('never falls back when the selected payment is no longer refundable',()=>{
    mocks.data=payments.map(p=>p.id==='third'?{...p,refunded_amount:663}:p);
    render(<PaymentRefundButton payment={payments[2]} orderNumber="SYNTHETIC"/>);
    fireEvent.click(screen.getByRole('button',{name:'Возврат'}));
    expect(screen.getByRole('alert')).toHaveTextContent('Выбранный платёж');
    fireEvent.change(screen.getByLabelText(/Причина возврата/),{target:{value:'Synthetic test'}});
    expect(screen.getByRole('button',{name:/Вернуть/})).toBeDisabled();
  });
  it.each([{status:'failed'},{transaction_type:'refund'},{is_deleted:true},{refunded_amount:663},{provider:'manual'}])('does not show a button for %j',patch=>{
    render(<PaymentRefundButton payment={{...payments[2],...patch}} orderNumber="SYNTHETIC"/>);
    expect(screen.queryByRole('button',{name:'Возврат'})).toBeNull();
  });
});
