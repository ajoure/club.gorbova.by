import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContactDealsTab } from './ContactDealsTab';
vi.mock('@/hooks/useStaffOptions', () => ({useStaffOptions: () => ({data: []})}));
describe('contact referral purchase', () => {
  it('shows bonus value without refund or paid revenue', () => {
    const paid = {id:'paid',product_id:'p',products_v2:{name:'Product'},status:'paid',final_price:250,paid_amount:250,currency:'BYN',created_at:'2026-10-01T12:00:00Z'};
    const referral = {...paid,id:'bonus',final_price:0,paid_amount:0,meta:{financial_kind:'referral_redemption',redemption_price_minor:75000}};
    render(<ContactDealsTab deals={[paid,referral]} isLoading={false} onOpenDeal={vi.fn()} onEditDeal={vi.fn()} onRefund={vi.fn()}/>);
    expect(screen.getByText('1 оплач.')).toBeTruthy();
    expect(screen.getByText('2 всего')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:/Product/}));
    expect(screen.getByText('По реферальной программе')).toBeTruthy();
    expect(screen.getByText(/750.*бонусами/)).toBeTruthy();
    expect(screen.getAllByTitle('Возврат')).toHaveLength(1);
    expect(screen.getByText('Выдано администратором')).toBeTruthy();
  });
});
