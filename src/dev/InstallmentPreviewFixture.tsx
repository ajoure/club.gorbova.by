import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { InternalInstallmentBlock } from "@/components/installments/InternalInstallmentBlock";
import { ContactInternalInstallments } from "@/components/installments/ContactInternalInstallments";

/**
 * DEV-only fixture route for Stage 4-5 UI proof.
 * URL: /__installment-preview?orderId=<uuid>
 */
export default function InstallmentPreviewFixture() {
  const [params] = useSearchParams();
  const orderId = params.get("orderId");
  const [order, setOrder] = useState<any>(null);

  useEffect(() => {
    if (!orderId) return;
    supabase
      .from("orders_v2")
      .select("*")
      .eq("id", orderId)
      .maybeSingle()
      .then(({ data }) => setOrder(data));
  }, [orderId]);

  if (!orderId) {
    return <div className="p-6">Add ?orderId=&lt;uuid&gt;</div>;
  }
  if (!order) {
    return <div className="p-6">Loading order {orderId}…</div>;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <section>
        <h2 className="text-lg font-bold mb-3">Stage 4: Deal block</h2>
        <InternalInstallmentBlock order={order} />
      </section>
      <section>
        <h2 className="text-lg font-bold mb-3">Stage 5: Contact tab</h2>
        <ContactInternalInstallments
          profileId={order.profile_id}
          userId={order.user_id}
        />
      </section>
    </div>
  );
}
