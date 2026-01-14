import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

// E3: Determine payment method from provider_response
export function detectPaymentMethodKind(
  cardBrand?: string | null,
  providerResponse?: any
): PaymentMethodKind {
  // Check for wallet payments first
  const walletType = providerResponse?.transaction?.three_d_secure_verification?.pa_status ||
                     providerResponse?.transaction?.payment_method_type ||
                     providerResponse?.payment_method_type;
  
  if (walletType) {
    const lowerWallet = String(walletType).toLowerCase();
    if (lowerWallet.includes('apple')) return 'apple_pay';
    if (lowerWallet.includes('google')) return 'google_pay';
    if (lowerWallet.includes('samsung')) return 'samsung_pay';
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
    if (lowerBrand.includes('belkart') || lowerBrand.includes('belcard')) return 'belkart';
  }
  
  return 'unknown';
}

// E4: Brand icons (using SVG inline for reliability)
const BrandIcons: Record<PaymentMethodKind, React.ReactNode> = {
  visa: (
    <svg viewBox="0 0 48 48" className="h-5 w-auto">
      <rect width="48" height="48" rx="6" fill="#1A1F71"/>
      <path d="M19.5 31H16.5L18.5 17H21.5L19.5 31Z" fill="white"/>
      <path d="M31 17L28.3 26.6L28 25L27 19.3C27 19.3 26.8 17 24.5 17H19L18.9 17.3C18.9 17.3 21.5 17.8 24 19.3L27 31H30L34 17H31Z" fill="white"/>
      <path d="M13 17L10 28L11.5 31H14.5L18 17H15L13 17Z" fill="white"/>
      <path d="M37 17H34L31 28L33 31H36L39 19C39 17.9 38.1 17 37 17Z" fill="white"/>
    </svg>
  ),
  mastercard: (
    <svg viewBox="0 0 48 48" className="h-5 w-auto">
      <rect width="48" height="48" rx="6" fill="#1A1F71"/>
      <circle cx="18" cy="24" r="10" fill="#EB001B"/>
      <circle cx="30" cy="24" r="10" fill="#F79E1B"/>
      <path d="M24 17.5C25.8 19.2 27 21.5 27 24C27 26.5 25.8 28.8 24 30.5C22.2 28.8 21 26.5 21 24C21 21.5 22.2 19.2 24 17.5Z" fill="#FF5F00"/>
    </svg>
  ),
  belkart: (
    <svg viewBox="0 0 48 48" className="h-5 w-auto">
      <rect width="48" height="48" rx="6" fill="#00843D"/>
      <text x="24" y="28" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="Arial">БК</text>
    </svg>
  ),
  apple_pay: (
    <svg viewBox="0 0 48 48" className="h-5 w-auto">
      <rect width="48" height="48" rx="6" fill="#000000"/>
      <path d="M16 20c.8-1 1.3-2.4 1.2-3.8-1.2.1-2.6.8-3.4 1.8-.7.9-1.4 2.2-1.2 3.5 1.3.1 2.6-.6 3.4-1.5zm1.2 1.6c-1.9-.1-3.5 1.1-4.4 1.1-.9 0-2.3-1-3.8-1-2 0-3.8 1.2-4.8 2.9-2 3.5-.5 8.7 1.5 11.6 1 1.4 2.1 3 3.7 2.9 1.5-.1 2-.9 3.8-.9s2.3.9 3.8.9c1.6 0 2.6-1.4 3.5-2.9 1.1-1.7 1.6-3.3 1.6-3.4 0-.1-3-1.2-3-4.6 0-2.9 2.4-4.2 2.5-4.3-1.4-2.1-3.5-2.3-4.4-2.3z" fill="white" transform="translate(11, 6) scale(0.8)"/>
    </svg>
  ),
  google_pay: (
    <svg viewBox="0 0 48 48" className="h-5 w-auto">
      <rect width="48" height="48" rx="6" fill="#FFFFFF" stroke="#E0E0E0"/>
      <path d="M24.5 23.2v3.5h-1.1v-8.7h2.9c.7 0 1.3.2 1.8.7.5.5.7 1 .7 1.7s-.2 1.2-.7 1.7c-.5.5-1.1.7-1.8.7h-1.8zm0-4.2v3.2h1.8c.4 0 .8-.2 1.1-.5.3-.3.4-.7.4-1.1 0-.4-.1-.8-.4-1.1-.3-.3-.7-.5-1.1-.5h-1.8z" fill="#3C4043"/>
      <path d="M32.1 21.5c.8 0 1.4.2 1.9.6.5.4.7 1 .7 1.7v3.5h-1v-.8c-.4.6-1 .9-1.7.9-.6 0-1.1-.2-1.5-.5-.4-.4-.6-.8-.6-1.4 0-.6.2-1 .6-1.4.4-.4.9-.5 1.6-.5.6 0 1 .1 1.4.4v-.3c0-.4-.1-.7-.4-1-.3-.3-.6-.4-1-.4-.6 0-1.1.3-1.3.8l-1-.4c.4-.8 1.1-1.2 2.3-1.2zm-.2 4.9c.3 0 .6-.1.9-.3.3-.2.4-.5.4-.8 0-.3-.1-.5-.4-.7-.3-.2-.6-.3-1-.3-.3 0-.6.1-.8.3-.2.2-.3.5-.3.8 0 .3.1.5.4.7.2.2.5.3.8.3z" fill="#3C4043"/>
      <path d="M38.5 26.7l-1.6-4.1h1.2l1 2.8 1-2.8h1.2l-2.4 6.2h-1.2l.8-2.1z" fill="#3C4043"/>
      <path d="M15.9 23.5c0-.3 0-.6-.1-.9h-4.1v1.7h2.3c-.1.5-.4 1-.8 1.3v1.1h1.3c.8-.8 1.4-1.9 1.4-3.2z" fill="#4285F4"/>
      <path d="M11.7 27.3c1.1 0 2-.4 2.7-1l-1.3-1c-.4.2-.8.4-1.4.4-1.1 0-2-.7-2.3-1.7H8.1v1.1c.7 1.3 2 2.2 3.6 2.2z" fill="#34A853"/>
      <path d="M9.4 24c-.1-.3-.2-.6-.2-.9s.1-.6.2-.9v-1.1H8.1c-.4.7-.6 1.5-.6 2.4s.2 1.7.6 2.4l1.3-1.9z" fill="#FBBC04"/>
      <path d="M11.7 20.5c.6 0 1.1.2 1.5.6l1.1-1.1c-.7-.7-1.6-1.1-2.6-1.1-1.6 0-2.9.9-3.6 2.2l1.3 1c.3-1 1.2-1.6 2.3-1.6z" fill="#EA4335"/>
    </svg>
  ),
  samsung_pay: (
    <svg viewBox="0 0 48 48" className="h-5 w-auto">
      <rect width="48" height="48" rx="6" fill="#1428A0"/>
      <text x="24" y="28" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold" fontFamily="Arial">Samsung</text>
    </svg>
  ),
  erip: (
    <svg viewBox="0 0 48 48" className="h-5 w-auto">
      <rect width="48" height="48" rx="6" fill="#E31E24"/>
      <text x="24" y="29" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="Arial">ЕРИП</text>
    </svg>
  ),
  unknown: (
    <svg viewBox="0 0 48 48" className="h-5 w-auto">
      <rect width="48" height="48" rx="6" fill="#9CA3AF"/>
      <text x="24" y="29" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold" fontFamily="Arial">?</text>
    </svg>
  ),
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

export default function PaymentMethodBadge({ 
  cardBrand, 
  cardLast4, 
  providerResponse,
  className 
}: PaymentMethodBadgeProps) {
  const methodKind = detectPaymentMethodKind(cardBrand, providerResponse);
  const hasCard = cardLast4 && cardLast4.trim() !== '';
  
  // E1: If no card data, show reason badge
  if (!hasCard) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-md",
            "bg-muted/50 border border-border/50",
            className
          )}>
            {BrandIcons[methodKind]}
            <span className="text-xs text-muted-foreground">{MethodLabels[methodKind]}</span>
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
          "flex items-center gap-1.5",
          className
        )}>
          {BrandIcons[methodKind]}
          <span className="font-mono text-xs">**** {cardLast4}</span>
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
