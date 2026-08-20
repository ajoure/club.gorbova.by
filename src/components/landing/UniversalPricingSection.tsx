import { useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AnimatedSection } from "./AnimatedSection";
import { TariffCard } from "./TariffCard";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { PreregistrationDialog } from "@/components/course/PreregistrationDialog";
import { LeadRequestDialog } from "@/components/lead/LeadRequestDialog";
import { InvoiceCheckoutDialog } from "@/components/payment/InvoiceCheckoutDialog";
import { ComposableCheckoutDialog } from "@/components/payment/ComposableCheckoutDialog";
import { detectInvoiceOnlyOffer } from "@/lib/invoiceCheckout";
import { readBankInstallmentMeta } from "@/lib/bankInstallment";
import { hasConfiguredCheckoutAddons } from "@/lib/composableCheckoutGate";
import { Skeleton } from "@/components/ui/skeleton";
import { TariffCarouselGrid } from "./TariffCarouselGrid";
import { AlertTriangle } from "lucide-react";
import type { PublicProduct, PublicTariff, TariffOffer } from "@/hooks/usePublicProduct";

type CheckoutSelection = { addonOfferIds: string[]; total: number; currency: string };

interface UniversalPricingSectionProps {
  product: PublicProduct;
  tariffs: PublicTariff[];
  pricingStage?: { id: string; name: string; stage_type: string } | null;
  sectionTitle?: string;
  sectionSubtitle?: string;
  disclaimer?: string;
  isReentryPricing?: boolean;
  reentryMessage?: string;
  /**
   * Layout mode for tariff cards.
   * - "auto": TariffCarouselGrid decides (carousel for >3, grid otherwise).
   * - "vertical-grid": Always vertical CSS grid — 1 col on mobile, 2 cols on md+. No carousel.
   *
   * ⚠️ DO NOT pass this prop in production product-driven flows
   * (public pages, site-builder pricing block, admin preview).
   * Layout MUST come from `product.landing_config.tariffs_layout` (single source of truth).
   * This prop exists only as a debug/test override and for non-product-driven rendering paths.
   */
  layout?: "auto" | "vertical-grid";
  cardRenderer?: (props: {
    tariff: PublicTariff;
    index: number;
    onSelectOffer: (offer: TariffOffer, tariff: PublicTariff) => void;
    showBadges: boolean;
    priceSuffix: string;
  }) => ReactNode;
  /**
   * How to route CTA clicks through the composable add-on selector.
   * - "auto" (default): open ComposableCheckoutDialog only when the server
   *   marks the offer with `has_available_addons === true` (SitePageBySlug parity).
   * - "always": open ComposableCheckoutDialog for every non-preregistration
   *   offer and let the dialog's built-in "empty quote" fallback auto-continue
   *   into the downstream flow when no add-ons are configured. Enables the
   *   composable UX on landings whose server payload does not surface the flag.
   */
  composableCheckoutMode?: "auto" | "always";
}

export function UniversalPricingSection({
  product,
  tariffs,
  sectionTitle,
  sectionSubtitle,
  disclaimer,
  isReentryPricing,
  reentryMessage,
  layout: layoutProp,
  cardRenderer,
  composableCheckoutMode = "auto",
}: UniversalPricingSectionProps) {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<{
    offer: TariffOffer;
    tariff: PublicTariff;
    productId: string;
  } | null>(null);
  const [checkoutSelection, setCheckoutSelection] = useState<CheckoutSelection | null>(null);

  const config = product.landing_config || {};
  const priceSuffix = config.price_suffix || "BYN";

  // SoT для раскладки тарифной секции — продукт.
  // Явный prop разрешён только для debug/test (см. JSDoc на UniversalPricingSectionProps.layout).
  const effectiveLayout: "auto" | "vertical-grid" =
    layoutProp ?? config.tariffs_layout ?? "auto";

  const handleSelectOffer = (offer: TariffOffer, tariff: PublicTariff) => {
    setSelectedOffer({ offer, tariff, productId: product.id });
    setCheckoutSelection(null);
    setPaymentOpen(true);
  };

  const handleDialogOpenChange = (open: boolean) => {
    setPaymentOpen(open);
    if (!open) {
      setSelectedOffer(null);
      setCheckoutSelection(null);
    }
  };

  if (!tariffs || tariffs.length === 0) return null;

  const title = sectionTitle || config.tariffs_title || product.public_title || "Тарифы";
  const subtitle = sectionSubtitle || config.tariffs_subtitle || product.public_subtitle || "Выберите подходящий вариант";
  const disclaimerText = disclaimer || product.payment_disclaimer_text ||
    "Безопасная оплата через bePaid. Принимаем Visa, Mastercard, Белкарт, ЕРИП.";
  const renderTariffCard = (tariff: PublicTariff, index: number) => {
    const showBadges = config.show_badges !== false;
    if (cardRenderer) {
      return cardRenderer({
        tariff,
        index,
        onSelectOffer: handleSelectOffer,
        showBadges,
        priceSuffix,
      });
    }

    return (
      <TariffCard
        tariff={tariff}
        onSelectOffer={handleSelectOffer}
        showBadges={showBadges}
        priceSuffix={priceSuffix}
      />
    );
  };

  return (
    <>
      <section id="tariffs" className="py-20">
        <div className="container mx-auto px-4">
          <AnimatedSection animation="fade-up">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
                {title}
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                {subtitle}
              </p>
            </div>
          </AnimatedSection>

          {/* Reentry pricing alert */}
          {isReentryPricing && reentryMessage && (
            <AnimatedSection className="max-w-2xl mx-auto mb-8">
              <Alert variant="destructive" className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800 dark:text-amber-200">
                  {reentryMessage}
                </AlertDescription>
              </Alert>
            </AnimatedSection>
          )}

          {effectiveLayout === "vertical-grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto items-stretch">
              {tariffs.map((tariff, index) => (
                <AnimatedSection key={tariff.id} animation="fade-up" delay={index * 100} className="h-full">
                  {renderTariffCard(tariff, index)}
                </AnimatedSection>
              ))}
            </div>
          ) : (
            <TariffCarouselGrid count={tariffs.length}>
              {tariffs.map((tariff, index) => (
                <AnimatedSection key={tariff.id} animation="fade-up" delay={index * 100} className="h-full">
                  {renderTariffCard(tariff, index)}
                </AnimatedSection>
              ))}
            </TariffCarouselGrid>
          )}

          {disclaimerText && (
            <AnimatedSection animation="fade-up" delay={400}>
              <p className="text-center text-sm text-muted-foreground mt-8 max-w-2xl mx-auto">
                {disclaimerText}
              </p>
            </AnimatedSection>
          )}
        </div>
      </section>

      {/* Composable checkout gate.
          - "auto": SitePageBySlug parity — only for offers the server marks
            with has_available_addons=true. This includes bank installments:
            their canonical backend accepts the selected addon_offer_ids.
          - "always": try the composable dialog for every non-preregistration
            offer (incl. lead / bank_installment). ComposableCheckoutDialog
            auto-continues without UI when the quote returns 0 add-ons, so
            offers without configured modules keep clean text behavior. */}
      {selectedOffer &&
        !checkoutSelection &&
        selectedOffer.offer.offer_type !== "preregistration" &&
        (composableCheckoutMode === "always"
          ? true
          : hasConfiguredCheckoutAddons(selectedOffer.offer)) ? (
        <ComposableCheckoutDialog
          open={paymentOpen}
          onOpenChange={handleDialogOpenChange}
          offerId={selectedOffer.offer.id}
          productName={product.public_title || product.name}
          tariffName={selectedOffer.tariff.name}
          paymentMethodLabel={selectedOffer.offer.button_label}
          onContinue={setCheckoutSelection}
        />
      ) : selectedOffer && (selectedOffer.offer.offer_type === "lead" || selectedOffer.offer.offer_type === "bank_installment") ? (
        <LeadRequestDialog
          open={paymentOpen}
          onOpenChange={handleDialogOpenChange}
          offerId={selectedOffer.offer.id}
          addonOfferIds={checkoutSelection?.addonOfferIds ?? []}
          offerLabel={selectedOffer.offer.button_label}
          productName={product.public_title || product.name}
          tariffName={selectedOffer.tariff.name}
          commentPlaceholder={(selectedOffer.offer as any).meta?.lead_form?.comment_placeholder}
          successMessage={(selectedOffer.offer as any).meta?.lead_form?.success_message}
          {...(selectedOffer.offer.offer_type === "bank_installment"
            ? readBankInstallmentMeta(selectedOffer.offer)
            : {})}
        />
      ) : selectedOffer && selectedOffer.offer.offer_type === "preregistration" ? (
        <PreregistrationDialog
          open={paymentOpen}
          onOpenChange={handleDialogOpenChange}
          tariffName={selectedOffer.tariff.name}
          offerId={selectedOffer.offer.id}
        />
      ) : selectedOffer && detectInvoiceOnlyOffer(selectedOffer.offer).isInvoiceOnly ? (
        <InvoiceCheckoutDialog
          open={paymentOpen}
          onOpenChange={handleDialogOpenChange}
          productId={selectedOffer.productId}
          productName={product.public_title || product.name}
          tariffName={selectedOffer.tariff.name}
          offerId={selectedOffer.offer.id}
          addonOfferIds={checkoutSelection?.addonOfferIds ?? []}
          amount={checkoutSelection?.total ?? selectedOffer.offer.amount}
          currency={checkoutSelection?.currency ?? product.currency ?? "BYN"}
        />
      ) : selectedOffer ? (
        <PaymentDialog
          open={paymentOpen}
          onOpenChange={handleDialogOpenChange}
          productId={selectedOffer.productId}
          productName={product.public_title || product.name}
          tariffName={selectedOffer.tariff.name}
          currency={checkoutSelection?.currency ?? product.currency ?? "BYN"}
          price={String(checkoutSelection?.total ?? selectedOffer.offer.amount)}
          tariffCode={selectedOffer.tariff.code}
          offerId={selectedOffer.offer.id}
          addonOfferIds={checkoutSelection?.addonOfferIds ?? []}
          isTrial={selectedOffer.offer.offer_type === "trial"}
          trialDays={selectedOffer.offer.trial_days ?? undefined}
          isClubProduct={!!product.telegram_club_id}
          isSubscription={
            !!selectedOffer.offer.requires_card_tokenization &&
            selectedOffer.offer.payment_method !== "internal_installment"
          }
          paymentMethod={selectedOffer.offer.payment_method}
          installmentMaxMonths={selectedOffer.offer.installment_count ?? null}
          installmentIntervalDays={(selectedOffer.offer as any).installment_interval_days ?? null}
          installmentTotalAmountKopecks={Math.round(
            Number(checkoutSelection?.total ?? selectedOffer.offer.amount) * 100,
          )}
        />
      ) : null}
    </>
  );
}

/** Loading skeleton for pricing section */
export function UniversalPricingSkeleton() {
  return (
    <section id="tariffs" className="py-20">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <Skeleton className="h-10 w-64 mx-auto mb-4" />
          <Skeleton className="h-6 w-96 mx-auto" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    </section>
  );
}
