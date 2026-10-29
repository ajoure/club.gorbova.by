import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/hooks/useContactInstallmentsData', () => ({ useContactInternalInstallments: () => ({ isLoading: false,
  data: [{ orderId: 'agreement', currency: 'BYN', uiStatus: 'review', totalCycles: 6, paidCycles: 4,
    perPayment: 339, effectiveTotal: 2034, paidTotal: 1356, remainingTotal: NaN, nextChargeAt: '2026-11-20T08:40:00Z' }] }) }));
import { InternalInstallmentBlock } from './InternalInstallmentBlock';

describe('deal installment shared projection', () => {
  it('shows the factual family receipts instead of the stale one-payment snapshot', () => {
    render(<InternalInstallmentBlock order={{ id: 'agreement', user_id: 'buyer', meta: {
      payment_method: 'internal_installment', installment: { model: 'bepaid_finite_subscription' },
      installment_progress: { paid_billing_cycles: 1, paid_total_byn: 339, remaining_total_byn: 1695, next_charge_at: '2026-08-22' },
    } }} />);
    expect(screen.getByText('Оплачено 4 из 6')).toBeInTheDocument();
    expect(screen.getByText(/1\s*356,00 BYN/)).toBeInTheDocument();
    expect(screen.queryByText(/1\s*695,00 BYN/)).not.toBeInTheDocument();
    expect(screen.getByText('20 ноября 2026')).toBeInTheDocument();
    expect(screen.getByText('Требует проверки')).toBeInTheDocument();
  });
});
