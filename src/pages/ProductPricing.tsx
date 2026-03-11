import { useParams } from "react-router-dom";
import { usePublicProductBySlug } from "@/hooks/usePublicProduct";
import { ProductLanding } from "@/components/landing/ProductLanding";
import { ProductLandingHeader } from "@/components/landing/ProductLandingHeader";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, ExternalLink } from "lucide-react";

export default function ProductPricing() {
  const { productSlug } = useParams<{ productSlug: string }>();
  const { user } = useAuth();
  const { data, isLoading, error } = usePublicProductBySlug(productSlug || null, user?.id);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Продукт не найден</h1>
          <p className="text-muted-foreground">
            Проверьте ссылку или обратитесь к администратору.
          </p>
        </div>
      </div>
    );
  }

  const primaryDomain = data.product.primary_domain;

  return (
    <div className="min-h-screen bg-background">
      {/* PATCH 8: Banner when primary_domain exists */}
      {primaryDomain && (
        <div className="bg-primary/10 border-b border-primary/20 py-2 px-4 text-center">
          <a
            href={`https://${primaryDomain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            Полная версия сайта: {primaryDomain}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      <ProductLandingHeader
        productName={data.product.public_title || data.product.name}
      />
      <ProductLanding productData={data} />
    </div>
  );
}
