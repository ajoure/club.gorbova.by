import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReleaseHealthCheck } from '@/components/admin/system-health/ReleaseHealthCheck';
const state=vi.hoisted(()=>({admin:true,invoke:vi.fn()}));
vi.mock('@/hooks/useSuperAdmin',()=>({useSuperAdmin:()=>({data:state.admin})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:(...args:unknown[])=>state.invoke(...args)}}}));
const names=['sales-runtime-worker','sales-runtime-control','telegram-webhook','telegram-media-worker','send-email:service','send-email:staff'];
const result=()=>({data:{ok:true,result:{ready:true,probes:names.map(f=>({function:f,status:200,matches:true}))}},error:null});
beforeEach(()=>{cleanup();state.admin=true;state.invoke.mockReset();});
describe('superadmin release diagnostics',()=>{
 it('is hidden from non-superadmins and never runs automatically',()=>{
  state.admin=false;const {container}=render(<ReleaseHealthCheck/>);expect(container).toBeEmptyDOMElement();expect(state.invoke).not.toHaveBeenCalled();
 });
 it('uses the existing fixed read-only action and requires all six runtime results',async()=>{
  state.invoke.mockResolvedValue(result());render(<ReleaseHealthCheck/>);expect(state.invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Проверить без отправки'}));
  expect(await screen.findByText('Все проверки пройдены')).toBeInTheDocument();
  expect(state.invoke).toHaveBeenCalledExactlyOnceWith('instagram-monitor',{body:{action:'release_health'}});
  expect(screen.getAllByText('Готово')).toHaveLength(6);
 });
 it('cannot show green for duplicate, missing or failed probes and never renders raw errors',async()=>{
  const duplicate=result();duplicate.data.result.probes[5]=duplicate.data.result.probes[0];state.invoke.mockResolvedValue(duplicate);
  const {unmount}=render(<ReleaseHealthCheck/>);fireEvent.click(screen.getByRole('button',{name:'Проверить без отправки'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось выполнить проверку');unmount();
  const failed=result();failed.data.result.probes[4].status=401;failed.data.result.probes[4].matches=false;state.invoke.mockResolvedValue(failed);
  render(<ReleaseHealthCheck/>);fireEvent.click(screen.getByRole('button',{name:'Проверить без отправки'}));
  expect(await screen.findByText('Проверка не пройдена')).toBeInTheDocument();expect(screen.queryByText('Все проверки пройдены')).toBeNull();
 });
});
