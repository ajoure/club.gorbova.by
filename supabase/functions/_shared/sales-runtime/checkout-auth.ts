import { requirePaymentsEdit, type AdminSectionAuthResult } from "../admin-section-auth.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
export async function sha256(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,"0")).join("");
}
/** Only the three named canonical writers accept this one-use, body-bound capability. */
export async function requireSalesOrPaymentsEdit(req: Request,db: SupabaseClient,endpoint: string,body?: unknown): Promise<AdminSectionAuthResult & {salesOperationId?:string}> {
  const token=req.headers.get("x-sales-checkout-capability");
  if (!token) return requirePaymentsEdit(req,db);
  if (!/^[a-f0-9]{64}$/.test(token)) return {ok:false,status:403,error:"forbidden"};
  const {data,error}=await db.rpc("sales_consume_checkout_capability",{p_hash:await sha256(token),p_endpoint:endpoint,p_body:body??await req.clone().json()});
  if(error||!data)return {ok:false,status:403,error:"forbidden"};
  const {data:operation,error:opError}=await db.from("sales_checkout_operations").select("id").eq("token_hash",await sha256(token)).single();
  if(opError||!operation)return {ok:false,status:403,error:"forbidden"};
  return {ok:true,actor:{id:data},salesOperationId:operation.id};
}
/** Eligibility remains bound to the recipient even if a private link is forwarded. */
export async function cbAlumniOfferAllowed(db: SupabaseClient,offerId: string|null|undefined,userId: string|null|undefined,forNewSale=false) {
 if(!offerId)return true;
 const {data:offer,error}=await db.from("tariff_offers").select("meta").eq("id",offerId).maybeSingle();
 if(error||!offer)throw Error("offer_eligibility_unavailable");
 if(forNewSale&&offer.meta?.sales_legacy_only===true)return false;
 if(!offer.meta?.purchase_eligibility)return true;
 if(!userId)return false;
 const {data,error:eligibilityError}=await db.rpc("sales_offer_eligibility",{p_user:userId,p_offer:offerId});
 if(eligibilityError)throw Error("eligibility_unavailable");
 return data?.eligible===true;
}
