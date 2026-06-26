/**
 * SitePageBySlug — thin public resolution layer.
 *
 * Hosts the `lovable:site-action` bridge: admin-authored HTML blocks (rendered
 * in sandboxed iframe via HtmlIframePreview) can request `open-offer` which
 * opens the existing PaymentDialog with a real trial offer. UUID-only payload,
 * strict validation, allow-list of actions.
 */

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { SiteRenderService } from "@/services/sitePages/SiteRenderService";
import { SitePageRenderer } from "@/components/site-renderer/SitePageRenderer";
import { useSitePricingData } from "@/hooks/useSitePricingData";
import { usePublicProduct } from "@/hooks/usePublicProduct";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import type { SiteBlock } from "@/services/sitePages/types";
import NotFound from "./NotFound";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set(["open-offer"]);

interface PendingOffer {
  productId: string;
  offerId: string;
}

export default function SitePageBySlug() {
  const { slug } = useParams<{ slug: string }>();
  const hashScrolled = useRef(false);

  const { data: page, isLoading } = useQuery({
    queryKey: ["site-page-public", slug],
    queryFn: () => SiteRenderService.resolveBySlug(slug!),
    enabled: !!slug,
  });

  const blocks = (page?.blocks as unknown as SiteBlock[]) || [];
  const { pricingData } = useSitePricingData(blocks);

  // ─── site-action bridge: open offer ───
  const [pending, setPending] = useState<PendingOffer | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const { data: pendingData } = usePublicProduct(pending ? { productId: pending.productId } : null);

  useEffect(() => {
    function onSiteAction(e: Event) {
      const ce = e as CustomEvent<{ action: string; payload: Record<string, string> }>;
      const detail = ce.detail;
      if (!detail || !ALLOWED_ACTIONS.has(detail.action)) return;
      if (detail.action !== "open-offer") return;
      const productId = String(detail.payload?.product_id || "");
      const offerId = String(detail.payload?.offer_id || "");
      if (!UUID_RE.test(productId) || !UUID_RE.test(offerId)) {
        console.warn("[site-action] open-offer: invalid UUID payload", detail.payload);
        return;
      }
      setPending({ productId, offerId });
      setPaymentOpen(true);
    }
    window.addEventListener("lovable:site-action", onSiteAction as EventListener);
    return () => window.removeEventListener("lovable:site-action", onSiteAction as EventListener);
  }, []);

  // Resolve offer + tariff once product data arrives.
  const resolved = (() => {
    if (!pending || !pendingData) return null;
    for (const t of pendingData.tariffs || []) {
      const offer = (t.offers || []).find((o) => o.id === pending.offerId);
      if (offer) return { tariff: t, offer, product: pendingData.product };
    }
    return null;
  })();

  // Scroll to hash anchor after page + pricing data loaded
  useEffect(() => {
    if (!page || hashScrolled.current) return;
    const hash = window.location.hash?.replace("#", "");
    if (!hash) return;

    // Support legacy #prices alias → scroll to #tariffs
    const targetId = hash === "prices" ? "tariffs" : hash;

    const tryScroll = () => {
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
        hashScrolled.current = true;
        return true;
      }
      return false;
    };

    const t1 = setTimeout(tryScroll, 300);
    const t2 = setTimeout(tryScroll, 800);
    const t3 = setTimeout(tryScroll, 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [page, pricingData]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!page) {
    return <NotFound />;
  }

  return (
    <div className="site-public-layout">
      <SitePageRenderer
        blocks={blocks}
        themeSettings={page.theme_settings || {}}
        pricingData={pricingData}
        pageId={page.id}
      />
      {resolved && (
        <PaymentDialog
          open={paymentOpen}
          onOpenChange={(v) => {
            setPaymentOpen(v);
            if (!v) setPending(null);
          }}
          productId={resolved.product.id}
          productName={resolved.tariff.name}
          price={String(resolved.offer.amount)}
          tariffCode={resolved.tariff.code}
          offerId={resolved.offer.id}
          isTrial={resolved.offer.offer_type === "trial"}
          trialDays={resolved.offer.trial_days ?? undefined}
          isClubProduct={!!resolved.product.telegram_club_id}
          isSubscription={
            !!resolved.offer.requires_card_tokenization &&
            resolved.offer.payment_method !== "internal_installment"
          }
          paymentMethod={resolved.offer.payment_method}
          installmentCount={resolved.offer.installment_count ?? null}
        />
      )}
    </div>
  );
}
