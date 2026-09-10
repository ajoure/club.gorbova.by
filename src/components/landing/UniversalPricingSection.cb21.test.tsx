import type { ReactNode } from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UniversalPricingSection } from './UniversalPricingSection';
import type { PublicProduct, PublicTariff } from '@/hooks/usePublicProduct';
import { CB21_PRODUCT_ID } from '@/pages/cb-native/tariffPublicContract';
const { capture } = vi.hoisted(() => ({capture: vi.fn()}));
vi.mock('./AnimatedSection',()=>({AnimatedSection:({children}:{children:ReactNode})=><>{children}</>}));
vi.mock('./TariffCarouselGrid',()=>({TariffCarouselGrid:({children}:{children:ReactNode})=><>{children}</>}));
vi.mock('@/components/payment/ComposableCheckoutDialog',()=>({ComposableCheckoutDialog:(p:any)=><button onClick={()=>p.onContinue({addonOfferIds:[],total:undefined,currency:'BYN'})}>Без дополнений</button>}));
vi.mock('@/components/payment/PaymentDialog',()=>({PaymentDialog:(p:any)=>{capture('payment',p);return null;}}));
vi.mock('@/components/payment/InvoiceCheckoutDialog',()=>({InvoiceCheckoutDialog:(p:any)=>{capture('invoice',p);return null;}}));
vi.mock('@/components/lead/LeadRequestDialog',()=>({LeadRequestDialog:(p:any)=>{capture('bank',p);return null;}}));
vi.mock('@/components/course/PreregistrationDialog',()=>({PreregistrationDialog:()=>null}));
const tariffIds=['3c749a5d-fa43-5552-b064-c66611dedd58','3b427617-b192-57fa-9ac4-e85c28a7ad2f','c558c63b-dd2f-5cc8-a990-ef4f0b3064c2'];
const offerIds=[
 ['2929ba16-51e1-5d4a-aaff-ae3754dde386','24e92d96-1872-57ed-934e-c9097b7f3381','d515cd28-8bec-5c6e-bc8b-56181d95f58d','35523d6e-06cc-5012-8070-14fb03c1e07a'],
 ['c4f7218c-cfd8-5380-911e-b25cfaad938e','f00c3934-5305-556e-8a65-ed8464e5ace4','50b5041c-dd8b-50bb-9c3d-0a628f7863a1','3ed3a575-e1bd-5c64-81c1-73fd52005a40'],
 ['5f79fccc-015f-5846-b423-aea2a2ba1ed1','91b14409-0e35-5034-aac7-ad820dbe871d','8028fdcf-fdf0-50fb-ad78-27dc3ca35e1a','1ec06293-920c-550d-bd14-4e8cbcdb5754'],
];
const tariffs=tariffIds.map((id,t)=>({id,code:`cb21-${t}`,name:`Тариф ${t}`,offers:offerIds[t].map((offerId,i)=>({id:offerId,tariff_id:id,amount:[1790,2190,2990][t],button_label:`Тариф ${t} способ ${i}`,offer_type:['pay_now','bank_installment','pay_now','invoice'][i],payment_method:['full_payment','bank_transfer','internal_installment','bank_transfer'][i],installment_count:i===2?2:null}))})) as PublicTariff[];
describe('all twelve cohort-21 payment actions',()=>{
 it.each(tariffs.flatMap((tariff,t)=>tariff.offers.map((offer,i)=>({tariff,offer,t,i}))))('routes $offer.id through the selected current offer',({tariff,offer,t,i})=>{
  capture.mockClear();
  render(<UniversalPricingSection product={{id:CB21_PRODUCT_ID,name:'21 поток'} as PublicProduct} tariffs={tariffs} composableCheckoutMode="always"
    cardRenderer={({tariff,onSelectOffer})=><>{tariff.offers.map(o=><button key={o.id} onClick={()=>onSelectOffer(o,tariff)}>{o.button_label}</button>)}</>} />);
  fireEvent.click(screen.getByRole('button',{name:offer.button_label}));
  expect(capture).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Без дополнений'}));
  const [kind,props]=capture.mock.lastCall!;
  expect(kind).toBe(i===1?'bank':i===3?'invoice':'payment');
  expect(props.offerId).toBe(offer.id);
  expect(props.tariffName).toBe(tariff.name);
  if(i!==1){
    expect(props.productId).toBe(CB21_PRODUCT_ID);
    expect(Number(i===3?props.amount:props.price)).toBe([1790,2190,2990][t]);
  }
  if(i===2){expect(props.installmentMaxMonths).toBe(2);expect(props.paymentMethod).toBe('internal_installment');}
 });
});
