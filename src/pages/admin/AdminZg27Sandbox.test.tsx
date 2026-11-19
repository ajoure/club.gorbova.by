import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import AdminZg27Sandbox from './AdminZg27Sandbox';
const mock=vi.hoisted(()=>({invoke:vi.fn(),getSession:vi.fn(),actor:'actor-A'}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mock.invoke},auth:{getSession:mock.getSession}}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:mock.actor}})}));
vi.mock('@/components/layout/AdminLayout',()=>({AdminLayout:({children}:any)=><div>{children}</div>}));
beforeEach(()=>{sessionStorage.clear();mock.invoke.mockReset();mock.actor='actor-A';mock.getSession.mockReset().mockImplementation(async()=>({data:{session:{user:{id:mock.actor},access_token:`jwt-${mock.actor}`}},error:null}))});afterEach(cleanup);
describe('sandbox operator sequence',()=>{
  it('runs fixed six plans once, stable run UUID and statuses only',async()=>{
    mock.invoke.mockImplementation(async(_name:string,{body}:any)=>({data:{case_id:body.case_id,status:'passed',test_confirmed:true,
      requests:Number(body.case_id.at(-1)),sum_minor:body.case_id.startsWith('first')?129000:89000,token:'never-display-token',secret:'never-display-secret'},error:null}));
    render(<AdminZg27Sandbox/>);const button=screen.getByRole('button',{name:'Запустить 6 TEST-планов'});fireEvent.click(button);fireEvent.click(button);
    await screen.findByText(/Все 6 тестовых планов пройдены/);
    expect(mock.invoke.mock.calls.map(([,args])=>args.body.case_id)).toEqual(['first_1','first_2','first_3','repeat_1','repeat_2','repeat_3']);
    expect(mock.invoke.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-actor-A');
    expect(new Set(mock.invoke.mock.calls.map(([,args])=>args.body.run_id)).size).toBe(1);
    expect(screen.queryByText(/never-display/)).not.toBeInTheDocument();expect(button).toBeDisabled();
  });
  it('late response after unmount never starts the next case',async()=>{
    let complete!:(value:any)=>void;mock.invoke.mockImplementation(()=>new Promise(resolve=>{complete=resolve}));
    const view=render(<AdminZg27Sandbox/>);fireEvent.click(screen.getByRole('button'));await waitFor(()=>expect(mock.invoke).toHaveBeenCalledOnce());
    view.unmount();await act(async()=>complete({data:{case_id:'first_1',status:'passed',test_confirmed:true,requests:1,sum_minor:129000},error:null}));
    expect(mock.invoke).toHaveBeenCalledOnce();
  });
  it('account switch clears private rows/run and ignores previous actor late completion',async()=>{
    let complete!:(value:any)=>void;
    mock.invoke.mockResolvedValueOnce({data:{case_id:'first_1',status:'passed',test_confirmed:true,requests:1,sum_minor:129000},error:null})
      .mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve}));
    const view=render(<AdminZg27Sandbox/>);fireEvent.click(screen.getByRole('button'));await waitFor(()=>expect(mock.invoke).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/TEST: пройдено/)).toBeInTheDocument();
    mock.actor='actor-B';view.rerender(<AdminZg27Sandbox/>);expect(screen.getByRole('button')).not.toBeDisabled();
    expect(screen.queryByText(/TEST: пройдено/)).not.toBeInTheDocument();
    await act(async()=>complete({data:{case_id:'first_2',status:'passed',test_confirmed:true,requests:2,sum_minor:129000},error:null}));
    expect(mock.invoke).toHaveBeenCalledTimes(2);expect(screen.queryByText(/TEST: пройдено/)).not.toBeInTheDocument();
    mock.actor='actor-A';view.rerender(<AdminZg27Sandbox/>);expect(screen.getByRole('button')).toBeDisabled();
  });
  it('fresh session mismatch prevents first dispatch even before auth context updates',async()=>{
    mock.getSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'other-jwt'}},error:null});
    render(<AdminZg27Sandbox/>);fireEvent.click(screen.getByRole('button'));await screen.findByText(/Аккаунт изменился или сессия завершилась/);
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it('stops immediately on unknown/non-test result and cannot resend on remount',async()=>{
    mock.invoke.mockResolvedValue({data:{case_id:'first_1',status:'stopped',test_confirmed:false,requests:1,sum_minor:0},error:null});
    const view=render(<AdminZg27Sandbox/>);fireEvent.click(screen.getByRole('button'));
    await waitFor(()=>expect(mock.invoke).toHaveBeenCalledOnce());await screen.findByText(/Проверка остановлена/);
    view.unmount();render(<AdminZg27Sandbox/>);expect(screen.getByRole('button')).toBeDisabled();expect(mock.invoke).toHaveBeenCalledOnce();
  });
});
