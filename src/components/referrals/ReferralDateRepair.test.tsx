import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {ReferralDateRepair} from './ReferralDateRepair';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke}}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const fill=()=>fireEvent.change(screen.getByLabelText('Пакет исправления дат'),{target:{value:'{"p_operation_key":"test"}'}});
it('requires successful unchanged preview and never retries an uncertain apply',async()=>{
 invoke.mockResolvedValueOnce({data:{result:{dry_run:true,no_writes:true}},error:null}).mockResolvedValueOnce({data:null,error:new Error('lost')});
 render(<ReferralDateRepair/>);fill();const apply=screen.getByText('Применить проверенные изменения');expect(apply).toBeDisabled();
 fireEvent.click(screen.getByText('Проверить без записи'));await waitFor(()=>expect(apply).toBeEnabled());
 fireEvent.click(apply);await screen.findByText(/Повтор заблокирован/);expect(apply).toBeDisabled();fireEvent.click(apply);expect(invoke).toHaveBeenCalledTimes(2);
 expect(invoke.mock.calls.map(c=>c[1].body.p_dry_run)).toEqual([true,false]);
});
it('editing package invalidates preview',async()=>{
 invoke.mockResolvedValue({data:{result:{dry_run:true,no_writes:true}},error:null});render(<ReferralDateRepair/>);fill();
 fireEvent.click(screen.getByText('Проверить без записи'));await waitFor(()=>expect(screen.getByText('Применить проверенные изменения')).toBeEnabled());
 fireEvent.change(screen.getByLabelText('Пакет исправления дат'),{target:{value:'{}'}});expect(screen.getByText('Применить проверенные изменения')).toBeDisabled();
});
