import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks=vi.hoisted(()=>({unlink:vi.fn(),read:vi.fn()}));
vi.mock("./companyContactOperations",()=>({isUnlinkableBillingContact:()=>true,unlinkBillingContact:mocks.unlink,readBillingUnlink:mocks.read}));
vi.mock("@/components/admin/shared/pickers/ContactPickerDialog",()=>({ContactPickerDialog:()=>null}));
vi.mock("sonner",()=>({toast:{success:vi.fn()}}));
import { BillingContactUnlink } from "./CompanyContactActions";
const contact={id:"edge",profile_id:"profile",relationship_type:"billing_contact",source:"billing_requisites",is_billing_contact:true,source_client_legal_details_map_id:"map"};
beforeEach(()=>{cleanup();vi.clearAllMocks();});
it("never resends an uncertain unlink and re-reads its result",async()=>{
  mocks.unlink.mockImplementation(async(_c,_e,_r,onDispatch)=>{onDispatch();throw Error("network uncertain");});mocks.read.mockResolvedValue(false);
  render(<BillingContactUnlink companyId="company" contact={contact} canManage onChanged={vi.fn()} />);
  fireEvent.click(screen.getByText("Отвязать плательщика"));fireEvent.change(screen.getByLabelText("Причина отвязки"),{target:{value:"correction"}});fireEvent.click(screen.getByText("Отвязать профиль"));
  await screen.findByText("network uncertain");expect(screen.queryByRole("button",{name:"Отвязать профиль"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Перечитать состояние"));await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(1));expect(mocks.unlink).toHaveBeenCalledTimes(1);
});
it("hides correction for non-admin callers",()=>{render(<BillingContactUnlink companyId="company" contact={contact} canManage={false} onChanged={vi.fn()} />);expect(screen.queryByText("Отвязать плательщика")).not.toBeInTheDocument();});
