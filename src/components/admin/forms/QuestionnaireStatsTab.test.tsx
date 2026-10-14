import {render,screen} from '@testing-library/react';
import {describe,it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({allowed:true,error:false,rows:[] as Array<Record<string,unknown>>}));
vi.mock('@/hooks/useAdminAccess',()=>({useAdminAccess:()=>({canAccessResource:()=>mocks.allowed})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('@tanstack/react-query',()=>({useQuery:({queryKey}:{queryKey:string[]})=>queryKey[0]==='questionnaire-stats-pages'
 ?{data:[{id:'page',title:'Анкета',slug:'form'}],isLoading:false,isError:false,refetch:vi.fn()}
 :{data:mocks.rows,isFetching:false,isError:mocks.error,refetch:vi.fn()}}));
import {QuestionnaireStatsTab} from './QuestionnaireStatsTab';
describe('questionnaire source statistics',()=>{
 beforeEach(()=>{mocks.allowed=true;mocks.error=false;mocks.rows=[];});
 it('shows webinar attribution in Russian while retaining raw tags and real funnel counts',()=>{
  mocks.rows=[{attribution:{src:'platforma',utm_source:'veb',utm_medium:'141026',utm_campaign:'cb21_preregistration',utm_content:'anketa_veb'},visits:12,visitors:10,questionnaires:7,contacts:7,new_accounts:5,existing_accounts:2}];
  render(<QuestionnaireStatsTab />);
  expect(screen.getByRole('cell',{name:'Продающий вебинар'})).toHaveAttribute('title','veb');
  expect(screen.getByRole('cell',{name:'Вебинар 14.10.2026'})).toHaveAttribute('title','141026');
  expect(screen.getByRole('cell',{name:'Анкета вебинара'})).toHaveAttribute('title','anketa_veb');
  expect(screen.getAllByRole('cell').slice(-6).map(cell=>cell.textContent)).toEqual(['12','10','7','7','5','2']);
 });
 it('does not present a failed stats query as zero clients',()=>{
  mocks.error=true;render(<QuestionnaireStatsTab />);
  expect(screen.getByRole('alert')).toHaveTextContent('Нулевые показатели не подставляются');
  expect(screen.queryByText(/переходов и заполнений пока нет/)).toBeNull();
 });
 it('honours the existing site forms permission',()=>{
  mocks.allowed=false;render(<QuestionnaireStatsTab />);
  expect(screen.getByRole('alert')).toHaveTextContent('Нет доступа');
  expect(screen.queryByLabelText('С даты')).toBeNull();
 });
});
