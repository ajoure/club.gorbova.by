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

interface Product {
  id: string;
  name: string;
  description: string | null;
  price_byn: number;
  currency: string;
  product_type: string;
  duration_days: number | null;
  tier: string | null;
  is_active: boolean;
}

export default function Pay() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const productId = searchParams.get("product");
  const [paymentOpen, setPaymentOpen] = useState(false);

  const { data: product, isLoading, error } = useQuery({
    queryKey: ["product", productId],
    queryFn: async () => {
      if (!productId) return null;
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("id", productId)
        .eq("is_active", true)
        .maybeSingle();
      
      if (error) throw error;
      return data as Product | null;
    },
    enabled: !!productId,
  });

  const formatPrice = (priceKopecks: number, currency: string) => {
    return `${(priceKopecks / 100).toFixed(2)} ${currency}`;
  };

  const getProductTypeLabel = (type: string) => {
    switch (type) {
      case "subscription":
        return "Подписка";
      case "webinar":
        return "Вебинар";
      case "one_time":
        return "Разовая покупка";
      default:
        return type;
    }
  };

  // Auto-open payment dialog if product is found
  useEffect(() => {
    if (product && !paymentOpen) {
      // Small delay to let the page render first
      const timer = setTimeout(() => setPaymentOpen(true), 500);
      return () => clearTimeout(timer);
    }
  }, [product]);

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

  if (error || !product) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
        <LandingHeader />
        <main className="container mx-auto px-4 py-24">
          <div className="max-w-md mx-auto text-center">
            <GlassCard className="p-8">
              <div className="text-6xl mb-4">😕</div>
              <h1 className="text-2xl font-bold mb-4">Продукт не найден</h1>
              <p className="text-muted-foreground mb-6">
                Данный продукт недоступен или был удалён. Пожалуйста, выберите другой продукт.
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

  const priceFormatted = formatPrice(product.price_byn, product.currency);

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
              <h1 className="text-2xl font-bold mb-2">{product.name}</h1>
              <p className="text-muted-foreground">{getProductTypeLabel(product.product_type)}</p>
            </div>

            {product.description && (
              <p className="text-center text-muted-foreground mb-6">
                {product.description}
              </p>
            )}

            <div className="space-y-3 mb-8">
              <div className="flex items-center gap-3 text-sm">
                <CheckCircle className="h-5 w-5 text-primary shrink-0" />
                <span>Мгновенный доступ после оплаты</span>
              </div>
              {product.duration_days && (
                <div className="flex items-center gap-3 text-sm">
                  <Clock className="h-5 w-5 text-primary shrink-0" />
                  <span>Срок действия: {product.duration_days} дней</span>
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
              {product.duration_days && (
                <p className="text-sm text-muted-foreground">
                  за {product.duration_days} дней
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
        productId={product.id}
        productName={product.name}
        price={priceFormatted}
      />
    </div>
  );
}
