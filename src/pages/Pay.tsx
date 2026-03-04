import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { CreditCard, CheckCircle, Clock, Shield, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

interface ProductV2Data {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  currency: string;
  is_active: boolean;
  tariff: {
    id: string;
    name: string;
    code: string;
    access_days: number | null;
  } | null;
  offer: {
    id: string;
    amount: number;
    button_label: string;
    offer_type: string;
    is_primary: boolean;
  } | null;
}

export default function Pay() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const productId = searchParams.get("product");
  const [paymentOpen, setPaymentOpen] = useState(false);

  // Fetch product from products_v2 + first active tariff + first active pay_now offer
  const { data: productData, isLoading, error } = useQuery({
    queryKey: ["pay-product-v2", productId],
    queryFn: async (): Promise<ProductV2Data | null> => {
      if (!productId) return null;

      // 1. Get product from products_v2
      const { data: product, error: prodErr } = await supabase
        .from("products_v2")
        .select("id, name, description, category, currency, is_active")
        .eq("id", productId)
        .eq("is_active", true)
        .maybeSingle();

      if (prodErr) throw prodErr;
      if (!product) return null;

      // 2. Get first active tariff for this product
      const { data: tariffs, error: tariffErr } = await supabase
        .from("tariffs")
        .select("id, name, code, access_days, is_active")
        .eq("product_id", productId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .limit(1);

      if (tariffErr) throw tariffErr;
      const tariff = tariffs?.[0] || null;

      // 3. Get primary active pay_now offer for the tariff
      let offer: ProductV2Data["offer"] = null;
      if (tariff) {
        const { data: offers, error: offerErr } = await supabase
          .from("tariff_offers")
          .select("id, amount, button_label, offer_type, is_primary")
          .eq("tariff_id", tariff.id)
          .eq("offer_type", "pay_now")
          .eq("is_active", true)
          .order("is_primary", { ascending: false })
          .order("sort_order", { ascending: true })
          .limit(1);

        if (offerErr) throw offerErr;
        offer = offers?.[0] || null;
      }

      return {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        currency: product.currency,
        is_active: product.is_active,
        tariff,
        offer,
      };
    },
    enabled: !!productId,
  });

  // Check if this product has club mappings (is a club product)
  const { data: clubMappings } = useQuery({
    queryKey: ["product-club-mappings", productId],
    queryFn: async () => {
      if (!productId) return null;
      const { data, error } = await supabase
        .from("product_club_mappings")
        .select("id")
        .eq("product_id", productId)
        .eq("is_active", true)
        .limit(1);
      
      if (error) throw error;
      return data;
    },
    enabled: !!productId,
  });

  const isClubProduct = (clubMappings?.length ?? 0) > 0;

  // Product is ready for payment only if it has an active offer with a price
  const isReadyForPayment = !!(productData?.offer && productData.offer.amount > 0);

  const formatPrice = (amountByn: number, currency: string) => {
    return `${amountByn.toFixed(2)} ${currency}`;
  };

  const getCategoryLabel = (category: string | null) => {
    switch (category) {
      case "subscription":
        return "Подписка";
      case "course":
        return "Курс";
      case "webinar":
        return "Вебинар";
      case "consultation":
        return "Консультация";
      default:
        return category || "Продукт";
    }
  };

  // Auto-open payment dialog if product is found and ready
  useEffect(() => {
    if (productData && isReadyForPayment && !paymentOpen) {
      const timer = setTimeout(() => setPaymentOpen(true), 500);
      return () => clearTimeout(timer);
    }
  }, [productData, isReadyForPayment]);

  if (!productId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
        <LandingHeader />
        <main className="container mx-auto px-4 py-24">
          <div className="max-w-md mx-auto text-center">
            <GlassCard className="p-8">
              <div className="text-6xl mb-4">🛒</div>
              <h1 className="text-2xl font-bold mb-4">Продукт не указан</h1>
              <p className="text-muted-foreground mb-6">
                Для оплаты необходимо выбрать продукт. Перейдите на страницу тарифов для выбора подписки.
              </p>
              <Button asChild>
                <Link to="/pricing">
                  Посмотреть тарифы
                </Link>
              </Button>
            </GlassCard>
          </div>
        </main>
        <LandingFooter />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
        <LandingHeader />
        <main className="container mx-auto px-4 py-24">
          <div className="max-w-lg mx-auto">
            <GlassCard className="p-8">
              <Skeleton className="h-8 w-3/4 mx-auto mb-4" />
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-2/3 mb-6" />
              <Skeleton className="h-12 w-full" />
            </GlassCard>
          </div>
        </main>
        <LandingFooter />
      </div>
    );
  }

  // Product not found or legacy UUID — show friendly error
  if (error || !productData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
        <LandingHeader />
        <main className="container mx-auto px-4 py-24">
          <div className="max-w-md mx-auto text-center">
            <GlassCard className="p-8">
              <div className="text-6xl mb-4">😕</div>
              <h1 className="text-2xl font-bold mb-4">Ссылка устарела</h1>
              <p className="text-muted-foreground mb-6">
                Данный продукт больше недоступен или ссылка устарела. Пожалуйста, выберите актуальный продукт.
              </p>
              <div className="flex flex-col gap-3">
                <Button asChild>
                  <Link to="/pricing">
                    Посмотреть тарифы
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/">
                    На главную
                  </Link>
                </Button>
              </div>
            </GlassCard>
          </div>
        </main>
        <LandingFooter />
      </div>
    );
  }

  // Product exists but no active offer — not ready for payment
  if (!isReadyForPayment) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
        <LandingHeader />
        <main className="container mx-auto px-4 py-24">
          <div className="max-w-md mx-auto text-center">
            <GlassCard className="p-8">
              <div className="text-6xl mb-4">🔧</div>
              <h1 className="text-2xl font-bold mb-4">Продукт не готов к оплате</h1>
              <p className="text-muted-foreground mb-6">
                Оплата для данного продукта временно недоступна. Пожалуйста, свяжитесь с нами или выберите другой продукт.
              </p>
              <Button asChild>
                <Link to="/pricing">
                  Посмотреть тарифы
                </Link>
              </Button>
            </GlassCard>
          </div>
        </main>
        <LandingFooter />
      </div>
    );
  }

  const priceFormatted = formatPrice(productData.offer!.amount, productData.currency);
  const accessDays = productData.tariff?.access_days;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      <LandingHeader />
      
      <main className="container mx-auto px-4 py-24">
        <div className="max-w-lg mx-auto">
          <Link 
            to="/pricing" 
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад к тарифам
          </Link>

          <GlassCard className="p-8">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                <CreditCard className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold mb-2">{productData.name}</h1>
              <p className="text-muted-foreground">{getCategoryLabel(productData.category)}</p>
            </div>

            {productData.description && (
              <p className="text-center text-muted-foreground mb-6">
                {productData.description}
              </p>
            )}

            <div className="space-y-3 mb-8">
              <div className="flex items-center gap-3 text-sm">
                <CheckCircle className="h-5 w-5 text-primary shrink-0" />
                <span>Мгновенный доступ после оплаты</span>
              </div>
              {accessDays && (
                <div className="flex items-center gap-3 text-sm">
                  <Clock className="h-5 w-5 text-primary shrink-0" />
                  <span>Срок действия: {accessDays} дней</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm">
                <Shield className="h-5 w-5 text-primary shrink-0" />
                <span>Безопасная оплата через bePaid</span>
              </div>
            </div>

            <div className="text-center mb-6">
              <div className="text-4xl font-bold text-primary mb-1">
                {priceFormatted}
              </div>
              {accessDays && (
                <p className="text-sm text-muted-foreground">
                  за {accessDays} дней
                </p>
              )}
            </div>

            <Button 
              size="lg" 
              className="w-full" 
              onClick={() => setPaymentOpen(true)}
            >
              <CreditCard className="mr-2 h-5 w-5" />
              Оплатить {priceFormatted}
            </Button>

            <p className="text-xs text-center text-muted-foreground mt-4">
              Нажимая кнопку, вы соглашаетесь с{" "}
              <Link to="/offer" className="text-primary hover:underline">
                условиями оферты
              </Link>
            </p>
          </GlassCard>
        </div>
      </main>

      <LandingFooter />

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        productId={productData.id}
        productName={productData.name}
        price={priceFormatted}
        tariffCode={productData.tariff?.code}
        offerId={productData.offer!.id}
        isClubProduct={isClubProduct}
      />
    </div>
  );
}
