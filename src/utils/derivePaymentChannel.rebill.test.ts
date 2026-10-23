import { describe, expect, it } from 'vitest';
import { derivePaymentChannel as frontend, type PaymentRowLike } from './derivePaymentChannel';
import { derivePaymentChannel as backend } from '../../supabase/functions/_shared/document-resolver-v2/payment-channel';

const rebill: PaymentRowLike = { provider: 'bepaid', meta: {
  source: 'rebill_flow_insert', materialization_run: 'bepaid_webhook_rebill_v2', bepaid_subscription_id: 'sbs-example',
} };
const cases: Array<[string, PaymentRowLike | null, string | null]> = [
  ['canonical card rebill without copied card fields', rebill, 'card'],
  ['unknown bePaid', { provider: 'bepaid' }, 'other'],
  ['arbitrary recurring flag', { provider: 'bepaid', meta: { is_recurring: true, bepaid_subscription_id: 'sbs-example' } }, 'other'],
  ['missing source', { ...rebill, meta: { ...rebill.meta, source: null } }, 'other'],
  ['missing run', { ...rebill, meta: { ...rebill.meta, materialization_run: null } }, 'other'],
  ['empty subscription', { ...rebill, meta: { ...rebill.meta, bepaid_subscription_id: ' ' } }, 'other'],
  ['wrong provider', { ...rebill, provider: 'admin' }, 'other'],
  ['explicit ERIP', { ...rebill, meta: { ...rebill.meta, is_erip: true } }, 'erip'],
  ['ERIP method', { ...rebill, meta: { ...rebill.meta, payment_method: 'erip' } }, 'erip'],
  ['bank transfer', { ...rebill, meta: { ...rebill.meta, payment_channel: 'bank_transfer' } }, 'bank_transfer'],
  ['Apple Pay', { ...rebill, meta: { ...rebill.meta, payment_method: 'apple_pay' } }, 'apple_pay'],
  ['Google Pay', { ...rebill, meta: { ...rebill.meta, payment_channel: 'google_pay' } }, 'google_pay'],
  ['explicit other', { ...rebill, meta: { ...rebill.meta, payment_channel: 'other' } }, 'other'],
  ['unrecognized method', { ...rebill, meta: { ...rebill.meta, payment_method: 'new-method' } }, 'other'],
  ['ordinary card unchanged', { provider: 'bepaid', card_last4: '1234' }, 'card'],
  ['Stripe unchanged', { provider: 'stripe' }, 'card'],
  ['no payment', null, null],
];
describe.each([['frontend', frontend], ['backend', backend]] as const)('%s channel resolver', (_name, derive) => {
  it.each(cases)('%s', (_label, input, expected) => expect(derive(input)).toBe(expected));
});
