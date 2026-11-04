import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({supabase:mocks}));
import { isUnlinkableBillingContact, linkRegisteredCompanyContact, unlinkBillingContact } from "./companyContactOperations";
const contact = {id:"edge",profile_id:"profile",source_client_legal_details_map_id:"map",relationship_type:"billing_contact",source:"billing_requisites",is_billing_contact:true};
const map = {id:"map",company_id:"company",client_legal_details_id:"details"};
const queues: Record<string, unknown[]> = {};
const queries: {table:string;filters:unknown[][]}[] = [];
function queue(table:string,...data:unknown[]) {queues[table]=data;}
beforeEach(() => {
  vi.clearAllMocks(); Object.keys(queues).forEach(k => delete queues[k]); queries.length=0;
  mocks.from.mockImplementation((table:string) => {
    const query={table,filters:[] as unknown[][]}; queries.push(query);
    const response = {data:queues[table]?.shift(),error:null};
    const b:any={select:()=>b,eq:(...args:unknown[])=>{query.filters.push(args);return b;},is:(...args:unknown[])=>{query.filters.push(args);return b;},single:()=>Promise.resolve(response),then:(resolve:any,reject:any)=>Promise.resolve(response).then(resolve,reject)};
    return b;
  });
});
describe("company contact correction boundary", () => {
  it("offers unlink only for the exact mapped billing edge", () => {
    expect(isUnlinkableBillingContact(contact)).toBe(true);
    for(const change of [{profile_id:null},{source_client_legal_details_map_id:null},{source:"manual"},{relationship_type:"director"},{is_billing_contact:false}]) {
      expect(isUnlinkableBillingContact({...contact,...change})).toBe(false);
    }
  });
  it("resolves exact map and invokes guarded unlink once with profile identity and real session",async () => {
    queue("client_legal_details_company_map",map);queue("company_contacts",[]);
    queue("crm_company_billing_link_suppressions",[{id:"suppression",contact_id:"edge",map_id:"map"}]);
    mocks.rpc.mockResolvedValue({data:{suppression_id:"suppression",unlinked:1},error:null});
    const dispatched=vi.fn();await unlinkBillingContact("company",contact," correction ",dispatched);
    expect(queries[0].filters).toEqual([["id","map"],["company_id","company"]]);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("crm_company_unlink_billing_contact",{
      _company_id:"company",_profile_id:"profile",_client_legal_details_id:"details",_expected_contact_id:"edge",_reason:"correction",
    });expect(dispatched).toHaveBeenCalledTimes(1);
  });
  it("rejects changed map before dispatch",async () => {
    queue("client_legal_details_company_map",{...map,company_id:"different"});const dispatched=vi.fn();
    await expect(unlinkBillingContact("company",contact,"correction",dispatched)).rejects.toThrow(/изменилась/);
    expect(mocks.rpc).not.toHaveBeenCalled();expect(dispatched).not.toHaveBeenCalled();
  });
  it("does not claim completion when the edge remains",async () => {
    queue("client_legal_details_company_map",map);queue("company_contacts",[{id:"edge"}]);queue("crm_company_billing_link_suppressions",[]);
    mocks.rpc.mockResolvedValue({data:{suppression_id:"suppression",unlinked:1},error:null});
    await expect(unlinkBillingContact("company",contact,"correction",vi.fn())).rejects.toThrow(/не подтверждена/);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([{user_id:null},{is_archived:true},{merged_to_profile_id:"merged"},{status:"inactive"}])("rejects non-active registered profile %o before writes",async change => {
    queue("profiles",{id:"profile",user_id:"auth-user",status:"active",is_archived:false,merged_to_profile_id:null,...change});
    await expect(linkRegisteredCompanyContact("company","profile","director",vi.fn())).rejects.toThrow(/зарегистрированный/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("links a registered employee using profiles.id, never auth user_id or external persona",async () => {
    queue("profiles",{id:"profile",user_id:"different-auth-user",status:"active",is_archived:false,merged_to_profile_id:null});
    queue("company_contacts",[],[{id:"new-edge",profile_id:"profile",relationship_type:"employee",source:"manual",is_billing_contact:false,source_client_legal_details_map_id:null}]);
    mocks.rpc.mockResolvedValue({data:"new-edge",error:null});
    await linkRegisteredCompanyContact("company","profile","employee",vi.fn());
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("crm_company_link_contact",{_company_id:"company",_profile_id:"profile",_relationship_type:"employee",_is_billing_contact:false,_source:"manual",_source_client_legal_details_map_id:null});
  });
  it("rejects duplicate profile before changing its role",async () => {
    queue("profiles",{id:"profile",user_id:"auth",status:"active",is_archived:false,merged_to_profile_id:null});queue("company_contacts",[{id:"existing"}]);
    await expect(linkRegisteredCompanyContact("company","profile","director",vi.fn())).rejects.toThrow(/уже связан/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
