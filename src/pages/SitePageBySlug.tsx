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
import { PublicPageFetchError } from "@/components/site-renderer/PublicPageFetchError";
import { useSitePricingData } from "@/hooks/useSitePricingData";
import { usePublicProduct } from "@/hooks/usePublicProduct";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { InvoiceCheckoutDialog } from "@/components/payment/InvoiceCheckoutDialog";
import { PreregistrationDialog } from "@/components/course/PreregistrationDialog";
import { LeadRequestDialog } from "@/components/lead/LeadRequestDialog";
import { detectInvoiceOnlyOffer } from "@/lib/invoiceCheckout";
import type { SiteBlock } from "@/services/sitePages/types";
import NotFound from "./NotFound";


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set(["open-offer", "open-preregistration", "open-payment"]);

interface PendingOffer {
  productId: string;
  offerId: string;
}

/**
 * Map an admin-HTML tariff key (data-lovable-tariff-key="…") to a tariff on the
 * linked product. Matches by substring of tariff.name (case-insensitive) so the
 * product's tariffs stay editable without HTML re-patch.
 * cb20 (Ценный бухгалтер): buh → «Бухгалтер», gl_buh → «Главный бухгалтер», biz-l → «Бизнес-леди».
 */
const TARIFF_KEY_NAME_MATCH: Record<string, (name: string) => boolean> = {
  buh: (n) => /^бухгалтер/i.test(n.trim()),
  gl_buh: (n) => /главн\S*\s+бухгалтер/i.test(n),
  "biz-l": (n) => /бизнес.?леди/i.test(n),
};


export default function SitePageBySlug() {
  const { slug } = useParams<{ slug: string }>();
  const hashScrolled = useRef(false);

  const { data: resolution, isLoading, refetch } = useQuery({
    queryKey: ["site-page-public", slug],
    queryFn: () => SiteRenderService.resolveBySlugSafe(slug!),
    enabled: !!slug,
    retry: (failureCount, _err) => failureCount < 2,
  });

  const page = resolution?.status === "ok" ? resolution.page : null;
  const blocks = (page?.blocks as unknown as SiteBlock[]) || [];
  const { pricingData } = useSitePricingData(blocks);


  // ─── site-action bridge: open offer ───
  const [pending, setPending] = useState<PendingOffer | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [preregOpen, setPreregOpen] = useState(false);
  const [preregOfferId, setPreregOfferId] = useState<string | null>(null);
  const { data: pendingData } = usePublicProduct(pending ? { productId: pending.productId } : null);

  useEffect(() => {
    function onSiteAction(e: Event) {
      const ce = e as CustomEvent<{ action: string; payload: Record<string, string> }>;
      const detail = ce.detail;
      if (!detail || !ALLOWED_ACTIONS.has(detail.action)) return;

      if (detail.action === "open-offer") {
        const productId = String(detail.payload?.product_id || "");
        const offerId = String(detail.payload?.offer_id || "");
        if (!UUID_RE.test(productId) || !UUID_RE.test(offerId)) {
          console.warn("[site-action] open-offer: invalid UUID payload", detail.payload);
          return;
        }
        setPending({ productId, offerId });
        setPaymentOpen(true);
        return;
      }

      if (detail.action === "open-preregistration") {
        const offerId = String(detail.payload?.offer_id || "");
        if (!UUID_RE.test(offerId)) {
          console.warn("[site-action] open-preregistration: invalid offer_id", detail.payload);
          return;
        }
        setPreregOfferId(offerId);
        setPreregOpen(true);
        return;
      }
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

  if (resolution?.status === "error") {
    return <PublicPageFetchError onRetry={() => refetch()} details={resolution.error} />;
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
      {resolved && (() => {
        if (resolved.offer.offer_type === "lead") {
          return (
            <LeadRequestDialog
              open={paymentOpen}
              onOpenChange={(v) => {
                setPaymentOpen(v);
                if (!v) setPending(null);
              }}
              offerId={resolved.offer.id}
              offerLabel={resolved.offer.button_label}
              productName={resolved.product.public_title || resolved.product.name}
              tariffName={resolved.tariff.name}
              commentPlaceholder={(resolved.offer as any).meta?.lead_form?.comment_placeholder}
              successMessage={(resolved.offer as any).meta?.lead_form?.success_message}
            />
          );
        }
        const invoiceDetect = detectInvoiceOnlyOffer(resolved.offer);
        if (invoiceDetect.isInvoiceOnly) {
          return (
            <InvoiceCheckoutDialog
              open={paymentOpen}
              onOpenChange={(v) => {
                setPaymentOpen(v);
                if (!v) setPending(null);
              }}
              productId={resolved.product.id}
              productName={resolved.product.public_title || resolved.product.name}
              tariffName={resolved.tariff.name}
              offerId={resolved.offer.id}
              amount={resolved.offer.amount}
              currency={resolved.product.currency || "BYN"}
            />
          );
        }
        return (
          <PaymentDialog
            open={paymentOpen}
            onOpenChange={(v) => {
              setPaymentOpen(v);
              if (!v) setPending(null);
            }}
            productId={resolved.product.id}
            productName={resolved.product.public_title || resolved.product.name}
            tariffName={resolved.tariff.name}
            currency={resolved.product.currency || "BYN"}
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
        );
      })()}
      {preregOfferId && (
        <PreregistrationDialog
          open={preregOpen}
          onOpenChange={(v) => {
            setPreregOpen(v);
            if (!v) setPreregOfferId(null);
          }}
          offerId={preregOfferId}
        />
      )}
    </div>
  );
}
