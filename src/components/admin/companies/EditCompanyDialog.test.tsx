import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const mocks=vi.hoisted(()=>({access:{isLoading:false,isAdmin:true,isSuperAdmin:false},from:vi.fn(),rpc:vi.fn()}));
vi.mock("@/hooks/useAdminAccess",()=>({useAdminAccess:()=>mocks.access}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{from:mocks.from,rpc:mocks.rpc}}));
vi.mock("sonner",()=>({toast:{success:vi.fn(),error:vi.fn()}}));
import { EditCompanyDialog } from "./EditCompanyDialog";
const company={id:"company",full_name:"Fixture",short_name:"Fixture",legal_form:"ЧУП",email:null,phone:null,country:"BY",company_kind:"legal_entity"};
const renderEditor=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{mutations:{retry:false},queries:{retry:false}}})}><EditCompanyDialog company={company} open onOpenChange={vi.fn()} onSaved={vi.fn()} /></QueryClientProvider>);
beforeEach(()=>{cleanup();vi.clearAllMocks();mocks.access={isLoading:false,isAdmin:true,isSuperAdmin:false};mocks.rpc.mockResolvedValue({data:"company",error:null});});
it("waits for authoritative address and sends expected old value through admin overload",async()=>{
  let resolve!:(value:unknown)=>void;const pending=new Promise(r=>resolve=r);
  const builder={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),single:()=>pending};mocks.from.mockReturnValue(builder);
  renderEditor();expect(screen.getByRole("button",{name:"Сохранить"})).toBeDisabled();
  resolve({data:{legal_address:"Old district, street"},error:null});
  await waitFor(()=>expect(screen.getByRole("button",{name:"Сохранить"})).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Юридический адрес"),{target:{value:"New district, street"}});
  fireEvent.click(screen.getByRole("button",{name:"Сохранить"}));
  await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledTimes(1));
  expect(mocks.rpc.mock.calls[0]).toEqual(["crm_company_update",expect.objectContaining({_id:"company",_legal_address:"New district, street",_expected_legal_address:"Old district, street"})]);
});
it("retains six-argument route and hides address from managers",async()=>{
  mocks.access.isAdmin=false;renderEditor();expect(screen.queryByLabelText("Юридический адрес")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Сохранить"}));await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledTimes(1));
  expect(Object.keys(mocks.rpc.mock.calls[0][1])).toHaveLength(6);expect(mocks.from).not.toHaveBeenCalled();
});
it("blocks saving when current address cannot be read",async()=>{
  const builder={select:()=>builder,eq:()=>builder,single:async()=>({data:null,error:{message:"read denied"}})};mocks.from.mockReturnValue(builder);
  renderEditor();await screen.findByRole("alert");expect(screen.getByRole("button",{name:"Сохранить"})).toBeDisabled();expect(mocks.rpc).not.toHaveBeenCalled();
});
