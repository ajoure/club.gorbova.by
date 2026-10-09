import {render,screen} from '@testing-library/react';
import {describe,it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({allowed:true,error:false}));
vi.mock('@/hooks/useAdminAccess',()=>({useAdminAccess:()=>({canAccessResource:()=>mocks.allowed})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('@tanstack/react-query',()=>({useQuery:({queryKey}:{queryKey:string[]})=>queryKey[0]==='questionnaire-stats-pages'
 ?{data:[{id:'page',title:'Анкета',slug:'form'}],isLoading:false,isError:false,refetch:vi.fn()}
 :{data:[],isFetching:false,isError:mocks.error,refetch:vi.fn()}}));
import {QuestionnaireStatsTab} from './QuestionnaireStatsTab';
describe('questionnaire source statistics',()=>{
 beforeEach(()=>{mocks.allowed=true;mocks.error=false;});
 it('does not present a failed stats query as zero clients',()=>{
  mocks.error=true;render(<QuestionnaireStatsTab />);
  expect(screen.getByRole('alert')).toHaveTextContent('Нулевые показатели не подставляются');
  expect(screen.queryByText(/переходов и заполнений пока нет/)).toBeNull();
 });
 it('honours the dedicated resource permission',()=>{
  mocks.allowed=false;render(<QuestionnaireStatsTab />);
  expect(screen.getByRole('alert')).toHaveTextContent('Нет доступа');
  expect(screen.queryByLabelText('С даты')).toBeNull();
 });
});
