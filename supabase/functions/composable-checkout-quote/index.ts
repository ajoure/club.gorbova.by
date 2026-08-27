import { createClient } from "npm:@supabase/supabase-js@2";
import { handleCorsPreflightRequest, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  ComposableCheckoutError,
  resolveComposableCheckout,
} from "../_shared/resolve-composable-checkout.ts";
import { requirePaymentsEdit } from "../_shared/admin-section-auth.ts";

interface RequestBody {
  parent_offer_id?: string;
  addon_offer_ids?: string[];
  adjustment_amount?: number;
  adjustment_reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const body = await req.json() as RequestBody;
  if (!body.parent_offer_id) return errorResponse("parent_offer_id_required", 400);

  const adjustment = Number(body.adjustment_amount ?? 0);
  if (adjustment !== 0) {
    const access = await requirePaymentsEdit(req, admin);
    if (!access.ok) return errorResponse(access.error, access.status);
  }
  if (adjustment !== 0 && !String(body.adjustment_reason ?? "").trim()) {
    return errorResponse("adjustment_reason_required", 400);
  }

  try {
    const quote = await resolveComposableCheckout(admin, {
      parentOfferId: body.parent_offer_id,
      addonOfferIds: body.addon_offer_ids,
      adjustmentAmount: adjustment,
      adjustmentReason: body.adjustment_reason,
    });
    return jsonResponse({
      success: true,
      ...quote,
    });
  } catch (error) {
    if (error instanceof ComposableCheckoutError) {
      return errorResponse(error.code, error.status);
    }
    return errorResponse("quote_failed", 500);
  }
});
