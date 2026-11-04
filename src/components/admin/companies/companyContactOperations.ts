import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export interface CompanyContactEdge {
  id: string;
  profile_id: string | null;
  relationship_type: string;
  source: string;
  is_billing_contact: boolean;
  source_client_legal_details_map_id: string | null;
}
// The generated app snapshot predates this pending schema asset. Keep the
// unlisted table boundary narrow and read-only instead of weakening all queries.
type SuppressionDatabase = { public: {
  Tables: { crm_company_billing_link_suppressions: {
    Row: {id:string;company_id:string;profile_id:string;contact_id:string;map_id:string;revoked_at:string | null};
    Insert: never; Update: never; Relationships: [];
  }}; Views: Record<string,never>; Functions: Record<string,never>;
}};
const suppressionReader = supabase as unknown as SupabaseClient<SuppressionDatabase>;
export type RegisteredCompanyRole = "director" | "employee";
export const isUnlinkableBillingContact = (contact: CompanyContactEdge) =>
  !!contact.profile_id && !!contact.source_client_legal_details_map_id &&
  contact.relationship_type === "billing_contact" && contact.source === "billing_requisites" && contact.is_billing_contact;

const rpc = <T>(name: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{data: T | null; error: {message: string} | null}>)(name, args);

export async function readBillingUnlink(companyId: string, contact: CompanyContactEdge) {
  const [edges, history] = await Promise.all([
    supabase.from("company_contacts").select("id").eq("company_id",companyId).eq("profile_id",contact.profile_id!),
    suppressionReader.from("crm_company_billing_link_suppressions").select("id, contact_id, map_id")
      .eq("company_id",companyId).eq("profile_id",contact.profile_id!).is("revoked_at",null),
  ]);
  if (edges.error) throw edges.error;
  if (history.error) throw history.error;
  return edges.data?.length === 0 && history.data?.some(s =>
    s.contact_id === contact.id && s.map_id === contact.source_client_legal_details_map_id) === true;
}

export async function unlinkBillingContact(companyId: string, contact: CompanyContactEdge, reason: string, onDispatch: () => void) {
  if (!isUnlinkableBillingContact(contact) || !reason.trim() || reason.trim().length > 500) throw new Error("Нужна точная связь плательщика и причина (до 500 символов)");
  const { data: map, error } = await supabase.from("client_legal_details_company_map")
    .select("id, company_id, client_legal_details_id").eq("id",contact.source_client_legal_details_map_id!)
    .eq("company_id",companyId).single();
  if (error) throw error;
  if (!map?.client_legal_details_id || map.company_id !== companyId || map.id !== contact.source_client_legal_details_map_id) throw new Error("Связь реквизитов изменилась. Перечитайте карточку");
  onDispatch();
  const result = await rpc<{ suppression_id: string; unlinked: number; already_unlinked?: boolean }>("crm_company_unlink_billing_contact", {
    _company_id: companyId, _profile_id: contact.profile_id, _client_legal_details_id: map.client_legal_details_id,
    _expected_contact_id: contact.id, _reason: reason.trim(),
  });
  if (result.error) throw result.error;
  if (!result.data?.suppression_id || !(result.data.unlinked === 1 || (result.data.unlinked === 0 && result.data.already_unlinked))) throw new Error("Результат отвязки не подтверждён");
  if (!await readBillingUnlink(companyId, contact)) throw new Error("Отвязка ещё не подтверждена чтением");
  return result.data;
}

export async function readRegisteredCompanyLink(companyId: string, profileId: string, role: RegisteredCompanyRole) {
  const {data, error} = await supabase.from("company_contacts")
    .select("id, profile_id, relationship_type, is_billing_contact, source, source_client_legal_details_map_id")
    .eq("company_id",companyId).eq("profile_id",profileId);
  if (error) throw error;
  return data?.length === 1 && data[0].relationship_type === role && data[0].is_billing_contact === false &&
    data[0].source === "manual" && data[0].source_client_legal_details_map_id === null;
}

export async function linkRegisteredCompanyContact(companyId: string, profileId: string, role: RegisteredCompanyRole, onDispatch: () => void) {
  if (role !== "director" && role !== "employee") throw new Error("Выберите роль");
  const { data: profile, error } = await supabase.from("profiles")
    .select("id, user_id, status, is_archived, merged_to_profile_id").eq("id",profileId).single();
  if (error) throw error;
  if (!profile || profile.id !== profileId || !profile.user_id || profile.status !== "active" ||
      profile.is_archived !== false || profile.merged_to_profile_id) throw new Error("Нужен действующий зарегистрированный профиль");
  const current = await supabase.from("company_contacts").select("id").eq("company_id",companyId).eq("profile_id",profileId);
  if (current.error) throw current.error;
  if (current.data?.length) throw new Error("Профиль уже связан с компанией. Перечитайте карточку");
  onDispatch();
  // profiles.id is the CRM identity; auth user_id is deliberately NOT passed.
  const result = await supabase.rpc("crm_company_link_contact", {
    _company_id: companyId, _profile_id: profile.id, _relationship_type: role,
    _is_billing_contact: false, _source: "manual", _source_client_legal_details_map_id: null,
  });
  if (result.error) throw result.error;
  if (!result.data || !await readRegisteredCompanyLink(companyId,profileId,role)) throw new Error("Связь ещё не подтверждена чтением");
  return result.data;
}
