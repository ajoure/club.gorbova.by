import {useState} from 'react';
import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {OfferPurchaseEligibilitySettings,validatePurchaseEligibility} from '../OfferPurchaseEligibilitySettings';
import type {OfferMetaConfig} from '@/hooks/useTariffOffers';
vi.mock('@tanstack/react-query',()=>({useQuery:()=>({data:{products:[{id:'course',name:'Прошлый курс'}],tariffs:[{id:'gift',code:'legacy-gift',product_id:'course',name:'Подарок'}]}})}));
describe('existing offer form eligibility settings',()=>{
 it('edits source/date/exclusions and preserves unrelated acquiring and document settings',()=>{
  let saved:OfferMetaConfig={acquiring:{allowed_payment_providers:['bepaid'],default_provider:'bepaid',customer_choice_enabled:false},document_defaults:{amount:1495}};
  function Form(){const [value,setValue]=useState(saved);return <OfferPurchaseEligibilitySettings value={value} onChange={next=>{saved=next;setValue(next)}}/>;}
  render(<Form/>);
  fireEvent.click(screen.getByLabelText('Требуется предыдущая оплаченная покупка'));
  expect(validatePurchaseEligibility(saved.purchase_eligibility)).not.toBeNull();
  fireEvent.click(screen.getByText('Добавить продукт'));
  fireEvent.change(screen.getByLabelText('Предыдущий продукт 1'),{target:{value:'course'}});
  fireEvent.change(screen.getByLabelText('Покупки начиная с даты (по Минску)'),{target:{value:'2024-01-01'}});
  fireEvent.click(screen.getByLabelText('Подарок'));
  expect(saved.purchase_eligibility?.sources[0]).toEqual({product_id:'course',purchased_from:'2024-01-01T00:00:00+03:00',excluded_tariff_ids:['gift','legacy-gift']});
  expect(validatePurchaseEligibility(saved.purchase_eligibility)).toBeNull();
  fireEvent.click(screen.getByLabelText('Подарок'));
  expect(saved.purchase_eligibility?.sources[0].excluded_tariff_ids).toEqual([]);
  expect(saved.acquiring?.default_provider).toBe('bepaid');expect(saved.document_defaults?.amount).toBe(1495);
 });
});
