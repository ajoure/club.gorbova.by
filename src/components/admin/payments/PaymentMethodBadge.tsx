import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CreditCard } from "lucide-react";

// Import brand images
import visaImg from "@/assets/brands/visa.png";
import mastercardImg from "@/assets/brands/mastercard.png";
import belkartImg from "@/assets/brands/belkart.png";
import applePayImg from "@/assets/brands/apple-pay.png";
import googlePayImg from "@/assets/brands/google-pay.png";
import samsungPayImg from "@/assets/brands/samsung-pay.png";
import eripImg from "@/assets/brands/erip.png";

// Payment method detection types
export type PaymentMethodKind = 
  | 'visa' 
  | 'mastercard' 
  | 'belkart' 
  | 'apple_pay' 
  | 'google_pay' 
  | 'samsung_pay' 
  | 'erip' 
  | 'unknown';

interface PaymentMethodBadgeProps {
  cardBrand?: string | null;
  cardLast4?: string | null;
  providerResponse?: any;
  className?: string;
}

// Determine payment method from provider_response
export function detectPaymentMethodKind(
  cardBrand?: string | null,
  providerResponse?: any
): PaymentMethodKind {
  // Check for wallet payments first (from provider_response)
  const walletType = providerResponse?.transaction?.three_d_secure_verification?.pa_status ||
                     providerResponse?.transaction?.payment_method_type ||
                     providerResponse?.payment_method_type ||
                     providerResponse?.transaction?.type;
  
  if (walletType) {
    const lowerWallet = String(walletType).toLowerCase();
    if (lowerWallet.includes('apple') || lowerWallet.includes('apple_pay')) return 'apple_pay';
    if (lowerWallet.includes('google') || lowerWallet.includes('google_pay')) return 'google_pay';
    if (lowerWallet.includes('samsung') || lowerWallet.includes('samsung_pay')) return 'samsung_pay';
    if (lowerWallet.includes('erip')) return 'erip';
  }
  
  // Check for ERIP
  const paymentMethod = providerResponse?.transaction?.payment_method_type ||
                        providerResponse?.payment_method_type;
  if (paymentMethod?.toLowerCase() === 'erip') return 'erip';
  
  // Check card brand
  if (cardBrand) {
    const lowerBrand = cardBrand.toLowerCase();
    if (lowerBrand.includes('visa')) return 'visa';
    if (lowerBrand.includes('master') || lowerBrand.includes('mc')) return 'mastercard';
    if (lowerBrand.includes('belkart') || lowerBrand.includes('belcard') || lowerBrand.includes('белкарт')) return 'belkart';
  }
  
  // Check for additional brand indicators in provider_response
  const creditCard = providerResponse?.transaction?.credit_card || providerResponse?.credit_card;
  if (creditCard?.brand) {
    const brand = String(creditCard.brand).toLowerCase();
    if (brand.includes('visa')) return 'visa';
    if (brand.includes('master') || brand.includes('mc')) return 'mastercard';
    if (brand.includes('belkart') || brand.includes('belcard')) return 'belkart';
  }
  
  return 'unknown';
}

// Brand images map
const BrandImages: Record<PaymentMethodKind, string | null> = {
  visa: visaImg,
  mastercard: mastercardImg,
  belkart: belkartImg,
  apple_pay: applePayImg,
  google_pay: googlePayImg,
  samsung_pay: samsungPayImg,
  erip: eripImg,
  unknown: null,
};

const MethodLabels: Record<PaymentMethodKind, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  belkart: 'Белкарт',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  samsung_pay: 'Samsung Pay',
  erip: 'ЕРИП',
  unknown: 'Без данных',
};

// Max widths for different brands to keep them compact and uniform
// Tuned for single-logo display without doubling
const BrandMaxWidths: Record<PaymentMethodKind, string> = {
  visa: 'max-w-[32px]',
  mastercard: 'max-w-[24px]',
  belkart: 'max-w-[32px]',
  apple_pay: 'max-w-[32px]',
  google_pay: 'max-w-[40px]',
  samsung_pay: 'max-w-[44px]',
  erip: 'max-w-[36px]',
  unknown: '',
};

// Brand icon component with fallback
function BrandIcon({ kind, className }: { kind: PaymentMethodKind; className?: string }) {
  const imageSrc = BrandImages[kind];
  const maxWidth = BrandMaxWidths[kind];
  
  if (imageSrc) {
    return (
      <img 
        src={imageSrc} 
        alt={MethodLabels[kind]}
        className={cn(
          "h-4 w-auto object-contain flex-shrink-0",
          maxWidth,
          className
        )}
        onError={(e) => {
          // Fallback to generic card icon
          e.currentTarget.style.display = 'none';
        }}
      />
    );
  }
  
  // Fallback for unknown
  return <CreditCard className={cn("h-4 w-4 text-muted-foreground flex-shrink-0", className)} />;
}

export default function PaymentMethodBadge({ 
  cardBrand, 
  cardLast4, 
  providerResponse,
  className 
}: PaymentMethodBadgeProps) {
  const methodKind = detectPaymentMethodKind(cardBrand, providerResponse);
  const hasCard = cardLast4 && cardLast4.trim() !== '';
  
  // E1: If no card data, show reason badge (wallet/ERIP/unknown)
  if (!hasCard) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md",
            "bg-muted/50 border border-border/50",
            "max-w-[130px] h-6",
            className
          )}>
            <BrandIcon kind={methodKind} />
            <span className="text-xs text-muted-foreground truncate leading-none">
              {MethodLabels[methodKind]}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <div>Метод оплаты: {MethodLabels[methodKind]}</div>
            {methodKind === 'unknown' && <div className="text-muted-foreground">Данные карты недоступны</div>}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  // E2: Card exists - show brand icon + last4
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          "inline-flex items-center gap-1.5 h-5",
          className
        )}>
          <BrandIcon kind={methodKind} />
          <span className="font-mono text-xs leading-none">**** {cardLast4}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs">
          <div>{MethodLabels[methodKind]}</div>
          {cardBrand && <div className="text-muted-foreground">{cardBrand}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
