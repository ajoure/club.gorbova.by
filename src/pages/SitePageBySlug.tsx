/**
 * SitePageBySlug — thin public resolution layer.
 *
 * Hosts the `lovable:site-action` bridge: admin-authored HTML blocks (rendered
 * in sandboxed iframe via HtmlIframePreview) can request `open-offer` which
 * opens the existing PaymentDialog with a real trial offer. UUID-only payload,
 * strict validation, allow-list of actions.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { SiteRenderService } from "@/services/sitePages/SiteRenderService";
import type { PublicPageResolution } from "@/services/sitePages/SiteRenderService";
import { SitePageRenderer } from "@/components/site-renderer/SitePageRenderer";
import { PublicPageFetchError } from "@/components/site-renderer/PublicPageFetchError";
import { useSitePricingData } from "@/hooks/useSitePricingData";
import { usePublicProduct } from "@/hooks/usePublicProduct";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { ComposableCheckoutDialog } from "@/components/payment/ComposableCheckoutDialog";
import { InvoiceCheckoutDialog } from "@/components/payment/InvoiceCheckoutDialog";
import { PreregistrationDialog } from "@/components/course/PreregistrationDialog";
import { LeadRequestDialog } from "@/components/lead/LeadRequestDialog";
import { LeadTariffPickerDialog, type LeadPickerOption } from "@/components/lead/LeadTariffPickerDialog";
import { detectInvoiceOnlyOffer } from "@/lib/invoiceCheckout";
import { readBankInstallmentMeta } from "@/lib/bankInstallment";
import { hasConfiguredCheckoutAddons } from "@/lib/composableCheckoutGate";
import { buildSlotManifest, pageHasDynamicSlots } from "@/lib/siteSlotManifest";
import { SiteSlotManifestContext } from "@/contexts/SiteSlotManifestContext";
import type { SiteBlock, SitePage } from "@/services/sitePages/types";
import NotFound from "./NotFound";
import { getCanonicalHostname } from "@/utils/accessAlias";


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set([
  "open-offer",
  "open-slot",
  "open-product-lead",
  "open-preregistration",
  "open-payment",
  "open-invoice",
  "open-installment",
  "open-lead",
  "open-bank-installment",
]);

/** Map action → flow used by pickOfferForFlow. */
const ACTION_TO_FLOW = {
  "open-payment": "payment",
  "open-invoice": "invoice",
  "open-installment": "installment",
  "open-lead": "lead",
  "open-bank-installment": "bank_installment",
} as const;
type Flow = (typeof ACTION_TO_FLOW)[keyof typeof ACTION_TO_FLOW];


interface PendingOffer {
  productId: string;
  offerId: string;
}

interface CheckoutSelection {
  addonOfferIds: string[];
  total: number;
  currency: string;
}

function configuredTariffKey(tariff: {
  code?: string | null;
  meta?: Record<string, any> | null;
}) {
  return String(tariff.meta?.site_slot_key || tariff.code || "").trim();
}

/**
 * Select the offer that matches the requested flow.
 * - lead        → offer_type='lead'
 * - installment → pay_now + payment_method='internal_installment'
 * - invoice     → explicitly configured invoice button
 * - payment     → pay_now, primary full_payment, ignoring installment/invoice-only
 */
function pickOfferForFlow(offers: readonly any[], flow: Flow) {
  const active = offers.filter((o) => o.is_active !== false);
  if (flow === "lead") return active.find((o) => o.offer_type === "lead") || null;
  if (flow === "bank_installment") return active.find((o) => o.offer_type === "bank_installment") || null;
  if (flow === "invoice") {
    // Legacy dynamic-slot pages use slot_role/site_button_variant on the offer.
    return (
      active.find((o) => o.offer_type === "invoice") ||
      active.find((o) => detectInvoiceOnlyOffer(o).isInvoiceOnly) ||
      null
    );
  }
  const pn = active.filter((o) => o.offer_type === "pay_now");
  if (flow === "installment") {
    return pn.find((o) => o.payment_method === "internal_installment") || null;
  }
  // payment: primary full_payment, non-installment, non-invoice-only (legacy detector).
  return (
    pn
      .filter(
        (o) =>
          o.payment_method !== "internal_installment" &&
          !detectInvoiceOnlyOffer(o).isInvoiceOnly,
      )
      .sort(
        (a, b) =>
          (b.is_primary === true ? 1 : 0) - (a.is_primary === true ? 1 : 0) ||
          (a.amount || 0) - (b.amount || 0),
      )[0] || null
  );
}


/**
 * Enumerate active lead offers on `product`, cross-checked against the current
 * slot manifest. Sort stable: tariff.sort_order ASC (NULLS LAST) → tariff name
 * (ru locale) → offer_id. Used both on click and on live re-sync while the
 * picker is open.
 */
function collectLeadOptions(
  product: any,
  manifest: { tariffs?: Array<{ tariff_id: string; offers: Array<{ offer_id: string }> }> } | null | undefined,
): LeadPickerOption[] {
  const out: Array<LeadPickerOption & { _sortOrder: number; _sortHasOrder: number }> = [];
  for (const t of product?.tariffs || []) {
    for (const o of t.offers || []) {
      if (o.offer_type !== "lead") continue;
      if (o.is_active === false) continue;
      const inManifest = !!manifest?.tariffs?.some(
        (mt) => mt.tariff_id === t.id && mt.offers.some((mo) => mo.offer_id === o.id),
      );
      if (!inManifest) continue;
      const so = typeof t.sort_order === "number" && Number.isFinite(t.sort_order) ? t.sort_order : null;
      out.push({
        tariff_id: t.id,
        tariff_name: t.name || t.code || "",
        offer_id: o.id,
        button_label: o.button_label || "",
        _sortOrder: so ?? Number.MAX_SAFE_INTEGER,
        _sortHasOrder: so === null ? 1 : 0,
      });
    }
  }
  out.sort(
    (a, b) =>
      a._sortHasOrder - b._sortHasOrder ||
      a._sortOrder - b._sortOrder ||
      a.tariff_name.localeCompare(b.tariff_name, "ru") ||
      a.offer_id.localeCompare(b.offer_id),
  );
  return out.map(({ _sortOrder, _sortHasOrder, ...rest }) => rest);
}


interface SitePageBySlugProps {
  /** DomainRouter already resolved a page for a custom-domain home route. */
  resolvedPage?: SitePage | null;
}

export default function SitePageBySlug({ resolvedPage = null }: SitePageBySlugProps) {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const hashScrolled = useRef(false);

  const { data: queriedResolution, isLoading: queryLoading, refetch } = useQuery<PublicPageResolution>({
    queryKey: ["site-page-public", window.location.hostname, window.location.pathname, slug],
    queryFn: async () => {
      const hostname = getCanonicalHostname(window.location.hostname);
      const isAppHost = hostname === "localhost" || hostname === "127.0.0.1" ||
        hostname === "club.gorbova.by" || hostname === "gorbova.by" ||
        hostname.includes(".lovable.app") || hostname.includes(".lovableproject.com");
      if (!isAppHost) {
        const domainResolution = await SiteRenderService.resolveByDomainAndPathSafe(
          hostname,
          window.location.pathname,
        );
        if (domainResolution.status !== "not-found") return domainResolution;
      }
      return SiteRenderService.resolveBySlugSafe(slug!);
    },
    enabled: !resolvedPage && !!slug,
    retry: (failureCount, _err) => failureCount < 2,
  });

  const resolution: PublicPageResolution | undefined = resolvedPage
    ? { status: "ok", page: resolvedPage }
    : queriedResolution;
  const isLoading = !resolvedPage && queryLoading;
  const page = resolution?.status === "ok" ? resolution.page : null;
  const blocks = (page?.blocks as unknown as SiteBlock[]) || [];
  const { pricingData } = useSitePricingData(blocks);

  useEffect(() => {
    if (resolution?.status !== "ok" || !resolution.canonicalSlug) return;
    if (resolution.canonicalSlug === slug) return;
    navigate(`/${resolution.canonicalSlug}${location.search}${location.hash}`, { replace: true });
  }, [location.hash, location.search, navigate, resolution, slug]);


  // ─── site-action bridge: open offer ───
  const [pending, setPending] = useState<PendingOffer | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [checkoutSelection, setCheckoutSelection] = useState<CheckoutSelection | null>(null);
  const [preregOpen, setPreregOpen] = useState(false);
  const [preregOfferId, setPreregOfferId] = useState<string | null>(null);
  const [leadPickerOpen, setLeadPickerOpen] = useState(false);
  const [leadPickerOptions, setLeadPickerOptions] = useState<LeadPickerOption[]>([]);
  const { data: pendingData } = usePublicProduct(pending ? { productId: pending.productId } : null);

  const hasDynamicSlots = useMemo(() => pageHasDynamicSlots(blocks), [blocks]);
  const linkedProductId = page?.product_id || null;
  const { data: linkedProductData } = usePublicProduct(
    linkedProductId ? { productId: linkedProductId } : null,
    null,
    { poll: hasDynamicSlots },
  );
  const linkedProductDataRef = useRef(linkedProductData);
  useEffect(() => { linkedProductDataRef.current = linkedProductData; }, [linkedProductData]);

  // Dynamic-slot manifest — only computed when page has slot markers and
  // linkedProductData resolved. Stable ref while offers array is identity-stable.
  const slotManifest = useMemo(
    () => (hasDynamicSlots ? buildSlotManifest(linkedProductData) : null),
    [hasDynamicSlots, linkedProductData],
  );
  const slotManifestRef = useRef(slotManifest);
  useEffect(() => { slotManifestRef.current = slotManifest; }, [slotManifest]);

  // Ids of HTML blocks that actually contain dynamic-slot markers. open-slot
  // clicks whose block_id is not in this set are rejected (strict provenance).
  const dynamicSlotBlockIdsRef = useRef<Set<string>>(new Set());
  // Ids of HTML blocks that carry product-level lead CTA markers.
  // open-product-lead clicks are only accepted from these blocks.
  const productLeadBlockIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const slotIds = new Set<string>();
    const leadIds = new Set<string>();
    for (const b of blocks || []) {
      if (b?.type !== "html") continue;
      const code = (b.content as Record<string, unknown> | undefined)?.code;
      if (typeof code !== "string") continue;
      if (code.includes("data-lovable-slot")) slotIds.add(b.id);
      if (code.includes("data-lovable-product-lead-cta")) leadIds.add(b.id);
    }
    dynamicSlotBlockIdsRef.current = slotIds;
    productLeadBlockIdsRef.current = leadIds;
  }, [blocks]);
  const pageIdRef = useRef<string | null>(page?.id ?? null);
  useEffect(() => { pageIdRef.current = page?.id ?? null; }, [page?.id]);

  // Sync an already-open picker with live product data / manifest changes.
  // Admin toggling lead offers while the picker is up must be reflected within
  // one polling tick — the user must never click a stale row.
  //   0 offers → close picker, clear options.
  //   1 offer  → close picker; next CTA click goes straight to the flow.
  //   2+ offers → refresh options in-place without closing.
  useEffect(() => {
    if (!leadPickerOpen) return;
    const product = linkedProductData;
    if (!product?.product?.id) {
      setLeadPickerOpen(false);
      setLeadPickerOptions([]);
      return;
    }
    const next = collectLeadOptions(product, slotManifest);
    if (next.length < 2) {
      setLeadPickerOpen(false);
      setLeadPickerOptions([]);
      return;
    }
    setLeadPickerOptions((prev) => {
      if (
        prev.length === next.length &&
        prev.every((p, i) => p.offer_id === next[i].offer_id && p.button_label === next[i].button_label)
      ) {
        return prev;
      }
      return next;
    });
  }, [leadPickerOpen, linkedProductData, slotManifest]);

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

      // Dynamic-slot canonical path (Phase B). UUID-only; never falls back to
      // a name-based resolver. Full revalidation:
      //   1) offer_id is a UUID present in linkedProductData
      //   2) belongs to payload.tariff_id
      //   3) tariff belongs to linked product
      //   4) offer is active
      //   5) offer.meta.slot_role matches payload.slot_role
      //   6) offer_id is present in the last posted slot manifest
      if (detail.action === "open-slot") {
        const p = detail.payload || {};
        const offerId = String(p.offer_id || "");
        const tariffId = String(p.tariff_id || "");
        const slotRole = String(p.slot_role || "");
        const productIdIn = String(p.product_id || "");
        const pageIdIn = String(p.page_id || "");
        const blockIdIn = String(p.block_id || "");
        if (!UUID_RE.test(offerId) || !UUID_RE.test(tariffId) || !UUID_RE.test(productIdIn)) {
          console.warn("[site-action] open-slot: invalid UUID payload", p);
          return;
        }
        const currentPageId = pageIdRef.current;
        if (!pageIdIn || !currentPageId || pageIdIn !== currentPageId) {
          console.warn("[site-action] open-slot: page_id mismatch", { got: pageIdIn, expected: currentPageId });
          return;
        }
        if (!blockIdIn || !dynamicSlotBlockIdsRef.current.has(blockIdIn)) {
          console.warn("[site-action] open-slot: block_id is not a dynamic-slot HTML block", { blockIdIn });
          return;
        }
        const product = linkedProductDataRef.current;
        if (!product?.product?.id) {
          console.warn("[site-action] open-slot: no linked product resolved yet");
          return;
        }
        if (productIdIn !== product.product.id) {
          console.warn("[site-action] open-slot: product_id mismatch", { got: productIdIn, expected: product.product.id });
          return;
        }
        const tariff = (product.tariffs || []).find((t) => t.id === tariffId);
        if (!tariff) {
          console.warn("[site-action] open-slot: tariff not on linked product", { tariffId });
          return;
        }
        const offer = (tariff.offers || []).find((o) => o.id === offerId);
        if (!offer) {
          console.warn("[site-action] open-slot: offer not on tariff", { offerId, tariffId });
          return;
        }
        if (offer.is_active === false) {
          console.warn("[site-action] open-slot: offer inactive", { offerId });
          return;
        }
        const offerRole = String((offer.meta as Record<string, unknown> | undefined)?.slot_role || "");
        if (!offerRole || offerRole !== slotRole) {
          console.warn("[site-action] open-slot: slot_role mismatch", { offerRole, slotRole });
          return;
        }
        // Cross-check against last posted manifest.
        const manifest = slotManifestRef.current;
        const inManifest = !!manifest?.tariffs?.some((t) =>
          t.tariff_id === tariffId && t.offers.some((o) => o.offer_id === offerId && o.slot_role === slotRole),
        );
        if (!inManifest) {
          console.warn("[site-action] open-slot: offer not in current manifest", { offerId });
          return;
        }
        setPending({ productId: product.product.id, offerId });
        setPaymentOpen(true);
        return;
      }

      // Product-level lead CTA. Payload contains ONLY {product_id, page_id,
      // block_id}. Parent enumerates active lead offers from linkedProductData
      // and either opens LeadRequestDialog (1 lead) or LeadTariffPickerDialog
      // (≥2 leads). No mapping between CTA element and tariff — the user picks.
      if (detail.action === "open-product-lead") {
        const p = detail.payload || {};
        const productIdIn = String(p.product_id || "");
        const pageIdIn = String(p.page_id || "");
        const blockIdIn = String(p.block_id || "");
        if (!UUID_RE.test(productIdIn)) {
          console.warn("[site-action] open-product-lead: invalid product_id", p);
          return;
        }
        const currentPageId = pageIdRef.current;
        if (!pageIdIn || !currentPageId || pageIdIn !== currentPageId) {
          console.warn("[site-action] open-product-lead: page_id mismatch", { got: pageIdIn, expected: currentPageId });
          return;
        }
        if (!blockIdIn || !productLeadBlockIdsRef.current.has(blockIdIn)) {
          console.warn("[site-action] open-product-lead: block_id is not a product-lead-cta block", { blockIdIn });
          return;
        }
        const product = linkedProductDataRef.current;
        if (!product?.product?.id) {
          console.warn("[site-action] open-product-lead: no linked product resolved yet");
          return;
        }
        if (productIdIn !== product.product.id) {
          console.warn("[site-action] open-product-lead: product_id mismatch", { got: productIdIn, expected: product.product.id });
          return;
        }
        const leadOptions = collectLeadOptions(product, slotManifestRef.current);
        if (leadOptions.length === 0) {
          console.warn("[site-action] open-product-lead: no active lead offers in manifest");
          setLeadPickerOpen(false);
          setLeadPickerOptions([]);
          return;
        }
        if (leadOptions.length === 1) {
          // Close any stale picker before opening the direct flow.
          setLeadPickerOpen(false);
          setLeadPickerOptions([]);
          setPending({ productId: product.product.id, offerId: leadOptions[0].offer_id });
          setPaymentOpen(true);
          return;
        }
        setLeadPickerOptions(leadOptions);
        setLeadPickerOpen(true);
        return;
      }


      if (detail.action in ACTION_TO_FLOW) {
        // Dynamic binding: resolve tariff_key against the page-linked product's tariffs,
        // pick offer that matches the requested flow. No UUIDs in the HTML.
        const flow = ACTION_TO_FLOW[detail.action as keyof typeof ACTION_TO_FLOW];
        const tariffKey = String(detail.payload?.tariff_key || "").trim();
        const product = linkedProductDataRef.current;
        if (!tariffKey || !product?.product?.id || !product.tariffs?.length) {
          console.warn(`[site-action] ${detail.action}: no product data or empty tariff_key`, { tariffKey });
          return;
        }
        const tariff = product.tariffs.find((t) => configuredTariffKey(t) === tariffKey);
        if (!tariff) {
          console.warn(`[site-action] ${detail.action}: tariff not found`, { tariffKey });
          return;
        }
        const offer = pickOfferForFlow(tariff.offers || [], flow);
        if (!offer) {
          console.warn(`[site-action] ${detail.action}: no matching offer on tariff`, { tariffKey, flow });
          return;
        }
        setPending({ productId: product.product.id, offerId: offer.id });
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
    <SiteSlotManifestContext.Provider value={slotManifest}>
    <div className="site-public-layout">
      <SitePageRenderer
        blocks={blocks}
        themeSettings={page.theme_settings || {}}
        pricingData={pricingData}
        pageId={page.id}
      />

      {resolved && (() => {
        const selection = checkoutSelection ?? {
          addonOfferIds: [],
          total: Number(resolved.offer.amount || 0),
          currency: resolved.product.currency || "BYN",
        };
        if (
          !checkoutSelection &&
          hasConfiguredCheckoutAddons(resolved.offer)
        ) {
          return (
            <ComposableCheckoutDialog
              open={paymentOpen}
              onOpenChange={(v) => {
                setPaymentOpen(v);
                if (!v) {
                  setPending(null);
                  setCheckoutSelection(null);
                }
              }}
              offerId={resolved.offer.id}
              productName={resolved.product.public_title || resolved.product.name}
              tariffName={resolved.tariff.name}
              paymentMethodLabel={resolved.offer.button_label}
              onContinue={setCheckoutSelection}
            />
          );
        }
        if (resolved.offer.offer_type === "lead" || resolved.offer.offer_type === "bank_installment") {
          const bank = resolved.offer.offer_type === "bank_installment"
            ? readBankInstallmentMeta(resolved.offer)
            : {};
          return (
            <LeadRequestDialog
              open={paymentOpen}
              onOpenChange={(v) => {
                setPaymentOpen(v);
                if (!v) {
                  setPending(null);
                  setCheckoutSelection(null);
                }
              }}
              offerId={resolved.offer.id}
              addonOfferIds={selection.addonOfferIds}
              offerLabel={resolved.offer.button_label}
              productName={resolved.product.public_title || resolved.product.name}
              tariffName={resolved.tariff.name}
              commentPlaceholder={(resolved.offer as any).meta?.lead_form?.comment_placeholder}
              successMessage={(resolved.offer as any).meta?.lead_form?.success_message}
              {...bank}
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
                if (!v) {
                  setPending(null);
                  setCheckoutSelection(null);
                }
              }}
              productId={resolved.product.id}
              productName={resolved.product.public_title || resolved.product.name}
              tariffName={resolved.tariff.name}
              offerId={resolved.offer.id}
              addonOfferIds={selection.addonOfferIds}
              amount={selection.total}
              currency={selection.currency}
            />
          );
        }
        return (
          <PaymentDialog
            open={paymentOpen}
            onOpenChange={(v) => {
              setPaymentOpen(v);
              if (!v) {
                setPending(null);
                setCheckoutSelection(null);
              }
            }}
            productId={resolved.product.id}
            productName={resolved.product.public_title || resolved.product.name}
            tariffName={resolved.tariff.name}
            currency={selection.currency}
            price={String(selection.total)}
            tariffCode={resolved.tariff.code}
            offerId={resolved.offer.id}
            addonOfferIds={selection.addonOfferIds}
            isTrial={resolved.offer.offer_type === "trial"}
            trialDays={resolved.offer.trial_days ?? undefined}
            isClubProduct={!!resolved.product.telegram_club_id}
            isSubscription={
              !!resolved.offer.requires_card_tokenization &&
              resolved.offer.payment_method !== "internal_installment"
            }
            paymentMethod={resolved.offer.payment_method}
            installmentMaxMonths={resolved.offer.installment_count ?? null}
            installmentIntervalDays={(resolved.offer as any).installment_interval_days ?? null}
            installmentTotalAmountKopecks={Math.round(selection.total * 100)}
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
      <LeadTariffPickerDialog
        open={leadPickerOpen}
        onOpenChange={setLeadPickerOpen}
        options={leadPickerOptions}
        productName={linkedProductData?.product?.public_title || linkedProductData?.product?.name}
        onSelect={(opt) => {
          // Re-validate the picked pair against latest product data. This
          // guards against the admin disabling an offer between the picker
          // opening and the user selecting.
          const product = linkedProductDataRef.current;
          const tariff = product?.tariffs?.find((t) => t.id === opt.tariff_id);
          const offer = tariff?.offers?.find((o) => o.id === opt.offer_id);
          if (!tariff || !offer || offer.is_active === false || offer.offer_type !== "lead") {
            console.warn("[site-action] open-product-lead: picked offer no longer valid", opt);
            setLeadPickerOpen(false);
            return;
          }
          const manifest = slotManifestRef.current;
          const stillInManifest = !!manifest?.tariffs?.some(
            (mt) => mt.tariff_id === opt.tariff_id && mt.offers.some((mo) => mo.offer_id === opt.offer_id),
          );
          if (!stillInManifest) {
            console.warn("[site-action] open-product-lead: picked offer left manifest", opt);
            setLeadPickerOpen(false);
            return;
          }
          setLeadPickerOpen(false);
          setPending({ productId: product!.product.id, offerId: opt.offer_id });
          setPaymentOpen(true);
        }}
      />
    </div>
    </SiteSlotManifestContext.Provider>
  );
}
