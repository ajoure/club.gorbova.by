import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState, emptyAnalysis } from '../../../../supabase/functions/_shared/custdev-contract';
const {mock}=vi.hoisted(()=>({mock:{value:null as any}}));
vi.mock('@/hooks/useCustdevWorkspace',()=>({useCustdevWorkspace:()=>mock.value}));
import { CustdevWorkshop } from './CustdevWorkshop';
beforeEach(()=>{const state=emptyState();state.segments=[{id:'s1',title:'Торговля',description:'Описание',decisionMaker:'Директор',reason:'Опыт',productTypeIds:[],questions:[{id:'q1',group:1,text:'Что мешает?',types:['active'],note:'',order:1}]}];state.interviews=[{id:'i1',segmentId:'s1',name:'Респондент',type:'active',category:null,portfolioRef:null,date:'',status:'completed',answers:[{id:'a1',questionId:'q1',snapshot:'Что мешает?',group:1,text:'Теряем время',status:'received',followups:[]}]}];state.analyses.s1={...emptyAnalysis(),sourceHash:'h1',quotes:[{id:'quote1',interviewId:'i1',questionId:'q1',sourceId:'a1',text:'Теряем время',category:'problem',excluded:false,manual:true,sourceVersion:'v'}]};mock.value={state,workspace:{id:'w1',revision:1,status:'submitted'},sources:{portfolio:[],products:[],context:{},lessons:[],warnings:[]},hashes:{s1:'h1'},loading:false,saveStatus:'saved',error:'',conflict:false,canEdit:false,isAdmin:true,runs:[],versions:[],historyMore:{runs:false,versions:false},draft:null,edit:vi.fn(),flush:vi.fn(),action:vi.fn(),reload:vi.fn(),getState:()=>state,getHashes:()=>({s1:'h1'})};});
afterEach(cleanup);
describe('custdev integrated lesson view',()=>{
 it('admin can open every accordion and navigate students while edits stay disabled',()=>{
  render(<CustdevWorkshop lessonId="l" blockId="b" ownerId="student" reviewMode/>);
  expect(screen.getByLabelText('Название целевого сегмента')).toBeDisabled();expect(screen.getByRole('button',{name:'+ Сегмент'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:/2. Проведение интервью/}));expect(screen.getByLabelText('Карточка интервью')).not.toBeDisabled();expect(screen.getByLabelText('Имя или псевдоним респондента')).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:/3. Анализ результатов/}));expect(screen.getByRole('button',{name:/Источник: Респондент/})).not.toBeDisabled();expect(screen.getByLabelText('Сегмент анализа')).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:/4. Позиционирование/}));expect(screen.getByLabelText('Сегмент для адаптации')).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:/5. УТП/}));expect(screen.getByLabelText('Сегмент для УТП')).not.toBeDisabled();expect(screen.getByRole('button',{name:'Утвердить результат'})).not.toBeDisabled();
 });
 it('student sees save vs submit status and can add a next question using the existing block',()=>{mock.value.canEdit=true;mock.value.isAdmin=false;mock.value.workspace.status='draft';render(<CustdevWorkshop lessonId="l" blockId="b"/>);expect(screen.getByText('Сохранено · в работе')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:/1. Исходная ситуация/}));fireEvent.click(screen.getByRole('button',{name:'+ Вопрос'}));expect(mock.value.edit).toHaveBeenCalled();expect(screen.getByRole('button',{name:'Завершить и отправить на проверку'})).toBeInTheDocument();});
});
it('loads earlier history pages through the same authorized endpoint',()=>{mock.value.historyMore={runs:true,versions:false};render(<CustdevWorkshop lessonId="l" blockId="b"/>);fireEvent.click(screen.getByText('История анализов и сдач'));fireEvent.click(screen.getByRole('button',{name:'Показать более ранние версии'}));return Promise.resolve().then(()=>expect(mock.value.action).toHaveBeenCalledWith('history',{runsOffset:0,versionsOffset:0}));});
