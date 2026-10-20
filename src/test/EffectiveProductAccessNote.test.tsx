import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EffectiveProductAccessNote } from '@/components/purchases/EffectiveProductAccessNote';
import { CB2_PRODUCT_ID } from '@/lib/cb2Access';
const state=vi.hoisted(()=>({data:null as any,isPending:false,isError:false}));
vi.mock('@/hooks/useCb2AccessWindow',()=>({useCb2AccessWindow:()=>state}));
describe('effective CB2 access date',()=>{
 it('shows the real bonus window in Minsk, separately from purchase expiry',()=>{
  Object.assign(state,{data:{has_access:true,effective_end_at:'2026-10-29T20:59:59Z',source_kind:'club_bonus'},isPending:false,isError:false});
  render(<EffectiveProductAccessNote userId="fixture" productId={CB2_PRODUCT_ID}/>);
  expect(screen.getByText('Доступ к курсу: до 29.10.2026, 23:59 (Минск)')).toBeInTheDocument();
  expect(screen.getByText('Бонус клуба')).toBeInTheDocument();
 });
 it('does not present an expired or failed lookup as unlimited access',()=>{
  Object.assign(state,{data:{has_access:false},isPending:false,isError:false});
  const {rerender}=render(<EffectiveProductAccessNote userId="fixture" productId={CB2_PRODUCT_ID}/>);
  expect(screen.getByText('Срок доступа к курсу завершён')).toBeInTheDocument();
  state.isError=true;rerender(<EffectiveProductAccessNote userId="fixture" productId={CB2_PRODUCT_ID}/>);
  expect(screen.getByText('Не удалось уточнить срок доступа. Обновите страницу.')).toBeInTheDocument();
 });
 it('does not alter other product cards',()=>{
  const {container}=render(<EffectiveProductAccessNote userId="fixture" productId="other"/>);expect(container).toBeEmptyDOMElement();
 });
});
