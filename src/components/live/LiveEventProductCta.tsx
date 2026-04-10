import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, ExternalLink, FileText, Eye } from "lucide-react";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { DomainEventService } from "@/lib/domain-events";

interface CtaBinding {
  id: string;
  product_id: string;
  tariff_id: string | null;
  offer_id: string | null;
  cta_type: string;
  display_mode: string;
  position: string;
  show_after_minutes: number | null;
  show_at: string | null;
  title_override: string | null;
  description_override: string | null;
  button_text_override: string | null;
  image_override: string | null;
  theme_override: Record<string, any> | null;
  is_active: boolean;
  sort_order: number;
  metadata: Record<string, any> | null;
}

interface RuntimeEvent {
  id: string;
  binding_id: string;
  event_type: string;
  created_at: string;
}

interface ProductInfo {
  id: string;
  name: string;
  slug: string | null;
}

interface TariffInfo {
  id: string;
  name: string;
  public_id: string | null;
}

interface OfferInfo {
  id: string;
  amount: number | null;
  button_label: string | null;
  offer_type: string | null;
}

interface LiveEventProductCtaProps {
  liveEventId: string;
  position: "under_video" | "sidebar" | "sticky";
  displayContext: "live" | "replay";
  eventStartedAt?: string | null;
}

/** Hook to check if there are active product CTA bindings for a position */
export function useHasActiveCtaBindings(liveEventId: string, position: string): boolean {
  const { data } = useQuery({
    queryKey: ["cta-bindings-exists", liveEventId, position],
    enabled: !!liveEventId,
    queryFn: async () => {
      const { count, error } = await (supabase
        .from("live_event_product_cta_bindings") as any)
        .select("id", { count: "exact", head: true })
        .eq("live_event_id", liveEventId)
        .eq("position", position)
        .eq("is_active", true);
      if (error) return 0;
      return count || 0;
    },
    staleTime: 60_000,
  });
  return (data || 0) > 0;
}

export function LiveEventProductCta({ liveEventId, position, displayContext, eventStartedAt }: LiveEventProductCtaProps) {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<{ productId: string; productName: string; price: string; offerId?: string } | null>(null);

  // Fetch active bindings for this position
  const { data: bindings } = useQuery({
    queryKey: ["cta-bindings", liveEventId, position],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("live_event_product_cta_bindings") as any)
        .select("*")
        .eq("live_event_id", liveEventId)
        .eq("position", position)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data || []) as CtaBinding[];
    },
  });

  // Fetch runtime events to determine visibility
  const { data: runtimeEvents } = useQuery({
    queryKey: ["cta-runtime", liveEventId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("live_event_cta_runtime_events") as any)
        .select("id, binding_id, event_type, created_at")
        .eq("live_event_id", liveEventId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as RuntimeEvent[];
    },
  });

  // Subscribe to realtime runtime events
  useEffect(() => {
    const channel = supabase
      .channel(`cta-runtime-${liveEventId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "live_event_cta_runtime_events",
        filter: `live_event_id=eq.${liveEventId}`,
      }, () => {
        // Invalidate will be handled by react-query refetch
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [liveEventId]);

  // Determine which bindings are currently visible
  const visibleBindings = useMemo(() => {
    if (!bindings?.length) return [];

    return bindings.filter((binding) => {
      // "always" mode — always visible
      if (binding.display_mode === "always") return true;

      // Data-driven: check runtime events for this binding
      if (runtimeEvents?.length) {
        const lastEvent = runtimeEvents.find((e) => e.binding_id === binding.id);
        if (lastEvent) {
          return lastEvent.event_type === "shown" || lastEvent.event_type === "replaced";
        }
      }

      // "after_minutes" — room self-computes visibility based on event start time
      if (binding.display_mode === "after_minutes" && binding.show_after_minutes != null && eventStartedAt) {
        const startMs = new Date(eventStartedAt).getTime();
        const showAfterMs = binding.show_after_minutes * 60 * 1000;
        return Date.now() >= startMs + showAfterMs;
      }

      // "at_datetime" — room self-computes
      if (binding.display_mode === "at_datetime" && binding.show_at) {
        return Date.now() >= new Date(binding.show_at).getTime();
      }

      // "manual" — only visible if runtime event says "shown"
      return false;
    });
  }, [bindings, runtimeEvents, eventStartedAt]);

  if (!visibleBindings.length) return null;

  const handleCtaClick = async (binding: CtaBinding, product: ProductInfo | null, tariff: TariffInfo | null, offer: OfferInfo | null) => {
    // Record click event with enriched metadata
    try {
      await (supabase.from("live_event_cta_runtime_events") as any).insert({
        live_event_id: liveEventId,
        binding_id: binding.id,
        event_type: "clicked",
        trigger_mode: "manual",
        metadata: {
          cta_type: binding.cta_type,
          product_id: binding.product_id,
          tariff_id: binding.tariff_id || null,
          offer_id: binding.offer_id || null,
          ...(binding.cta_type === "external_link" ? { external_url: (binding.metadata as any)?.external_url } : {}),
        },
      });
    } catch { /* non-blocking */ }

    switch (binding.cta_type) {
      case "buy_now": {
        if (product) {
          setPaymentTarget({
            productId: product.id,
            productName: `${product.name}${tariff ? ` – ${tariff.name}` : ""}`,
            price: offer?.amount != null ? String(offer.amount) : "0",
            offerId: offer?.id || binding.offer_id || undefined,
          });
          setPaymentOpen(true);
        }
        break;
      }
      case "open_product": {
        if (product?.slug) {
          window.location.href = `/product/${product.slug}`;
        }
        break;
      }
      case "open_tariff": {
        if (tariff?.public_id) {
          window.location.href = `/tariff/${tariff.public_id}`;
        } else if (product?.slug) {
          window.location.href = `/product/${product.slug}`;
        }
        break;
      }
      case "lead_form":
      case "preorder": {
        // Navigate to product page where form exists
        if (product?.slug) {
          window.location.href = `/product/${product.slug}`;
        }
        break;
      }
      case "external_link": {
        const url = (binding.metadata as any)?.external_url;
        if (url && typeof url === "string") {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        break;
      }
    }
  };

  return (
    <>
      <div className="space-y-2">
        {visibleBindings.map((binding) => (
          <CtaCard
            key={binding.id}
            binding={binding}
            liveEventId={liveEventId}
            onCtaClick={handleCtaClick}
          />
        ))}
      </div>

      {paymentTarget && (
        <PaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          productId={paymentTarget.productId}
          productName={paymentTarget.productName}
          price={paymentTarget.price}
          offerId={paymentTarget.offerId}
        />
      )}
    </>
  );
}

function CtaCard({
  binding,
  liveEventId,
  onCtaClick,
}: {
  binding: CtaBinding;
  liveEventId: string;
  onCtaClick: (binding: CtaBinding, product: ProductInfo | null, tariff: TariffInfo | null, offer: OfferInfo | null) => void;
}) {
  // Fetch product info
  const { data: product } = useQuery({
    queryKey: ["product-info", binding.product_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name, slug")
        .eq("id", binding.product_id)
        .single();
      return data as ProductInfo | null;
    },
    staleTime: 60_000,
  });

  // Fetch tariff if specified
  const { data: tariff } = useQuery({
    queryKey: ["tariff-info", binding.tariff_id],
    enabled: !!binding.tariff_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("tariffs")
        .select("id, name, public_id")
        .eq("id", binding.tariff_id!)
        .single();
      return data as TariffInfo | null;
    },
    staleTime: 60_000,
  });

  // Fetch offer if specified
  const { data: offer } = useQuery({
    queryKey: ["offer-info", binding.offer_id],
    enabled: !!binding.offer_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("tariff_offers")
        .select("id, amount, button_label, offer_type")
        .eq("id", binding.offer_id!)
        .single();
      return data as OfferInfo | null;
    },
    staleTime: 60_000,
  });

  const title = binding.title_override || product?.name || "Предложение";
  const description = binding.description_override || "";
  const buttonText = binding.button_text_override || offer?.button_label || getDefaultButtonText(binding.cta_type);
  const ButtonIcon = getCtaIcon(binding.cta_type);

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-3 space-y-2">
        {binding.image_override && (
          <img src={binding.image_override} alt={title} className="w-full rounded-md object-cover max-h-32" />
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{title}</p>
            {description && <p className="text-xs text-muted-foreground line-clamp-2">{description}</p>}
            {offer?.amount != null && binding.cta_type === "buy_now" && (
              <Badge variant="secondary" className="mt-1 text-xs">{offer.amount} BYN</Badge>
            )}
          </div>
        </div>
        <Button
          size="sm"
          className="w-full gap-1.5 text-xs"
          onClick={() => onCtaClick(binding, product || null, tariff || null, offer || null)}
        >
          <ButtonIcon className="h-3.5 w-3.5" />
          {buttonText}
        </Button>
      </CardContent>
    </Card>
  );
}

function getDefaultButtonText(ctaType: string): string {
  switch (ctaType) {
    case "buy_now": return "Купить";
    case "open_product": return "Подробнее";
    case "open_tariff": return "Выбрать тариф";
    case "lead_form": return "Оставить заявку";
    case "preorder": return "Предзапись";
    case "external_link": return "Перейти";
    default: return "Подробнее";
  }
}

function getCtaIcon(ctaType: string) {
  switch (ctaType) {
    case "buy_now": return ShoppingCart;
    case "external_link": return ExternalLink;
    case "lead_form":
    case "preorder": return FileText;
    default: return Eye;
  }
}
