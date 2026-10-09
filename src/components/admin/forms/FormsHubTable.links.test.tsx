import {render,screen,fireEvent} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {describe,it,expect,vi} from 'vitest';
import {FormsHubTable} from './FormsHubTable';
import type {FormsHubRow} from '@/hooks/useFormsHubData';
const row={id:'form',source_type:'site_form',created_at:'2026-10-09T12:00:00Z',has_deal:true,has_account:true,raw:{order_id:'draft'},profile_id:'profile',user_id:'account'} as FormsHubRow;
function Location(){const location=useLocation();return <output aria-label="destination">{location.pathname+location.search}</output>;}
function show(){render(<MemoryRouter><FormsHubTable rows={[row]} isLoading={false} onOpenDetail={vi.fn()} variant="embedded"/><Location/></MemoryRouter>);}
describe('form links',()=>{
 it('opens the zero-price draft with the supported deal parameter',()=>{show();fireEvent.click(screen.getByTitle('Открыть сделку'));expect(screen.getByLabelText('destination')).toHaveTextContent('/admin/deals?deal=draft&from=forms');});
 it('uses the canonical CRM profile when both profile and account are known',()=>{show();fireEvent.click(screen.getByTitle('Открыть контакт'));expect(screen.getByLabelText('destination')).toHaveTextContent('/admin/contacts?contact=profile&from=forms');});
});
