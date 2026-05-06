// Single source of truth for footer data. Both UnifiedFooter (legacy) and
// the new Site Builder `footer` block read defaults from here.
// Editing inside a builder page only changes that page's block.content;
// global UnifiedFooter and other pages are NOT affected.

import logoImage from "@/assets/logo.png";
import paymentSystemsImage from "@/assets/payment-systems.png";
import eripLogoImage from "@/assets/erip-logo.png";

export const FOOTER_ASSETS = {
  logo: logoImage,
  paymentSystems: paymentSystemsImage,
  erip: eripLogoImage,
};

export const BRAND_INFO = {
  logoUrl: logoImage,
  name: "БУКВА ЗАКОНА",
  subtitle: "Клуб по законодательству",
  description: "",
};

export const COMPANY_INFO = {
  name: "ЗАО «АЖУР инкам»",
  unp: "193405000",
  legalAddress: "220035, г. Минск, ул. Панфилова, 2, офис 49Л",
  mailingAddress: "220052, Республика Беларусь, г. Минск, а/я 63",
  phone: "+375 29 171-43-21",
  phoneHref: "tel:+375291714321",
  email: "info@ajoure.by",
  workHours: "Пн–Пт 9:00–18:00 (Минск)",
};

export interface FooterNavItem {
  label: string;
  href: string;
  openInNewTab?: boolean;
}

export const NAV_LINKS: FooterNavItem[] = [
  { label: "Контакты", href: "/contacts" },
  { label: "Помощь", href: "/help" },
  { label: "Вход", href: "/auth" },
];

export const LEGAL_LINKS: FooterNavItem[] = [
  { label: "Публичная оферта", href: "/offer" },
  { label: "Заказ и оплата услуг", href: "/order-payment" },
  { label: "Политика конфиденциальности", href: "/privacy" },
  { label: "Согласие на обработку данных", href: "/consent" },
  { label: "Инструкция по оформлению расходов", href: "/instruction" },
];

export interface FooterSocialItem {
  platform: string;
  url: string;
  label: string;
}

export const SOCIAL_LINKS: FooterSocialItem[] = [];

export interface FooterBlockContent {
  brand: {
    showBrand: boolean;
    logoUrl: string;
    name: string;
    subtitle: string;
    description: string;
  };
  company: {
    showCompany: boolean;
    name: string;
    unp: string;
    legalAddress: string;
    mailingAddress: string;
    phone: string;
    phoneHref: string;
    email: string;
    workHours: string;
  };
  navigation: {
    showNavigation: boolean;
    title: string;
    items: Array<FooterNavItem>;
  };
  legal: {
    showLegal: boolean;
    title: string;
    items: Array<FooterNavItem>;
  };
  social: {
    showSocial: boolean;
    title: string;
    items: Array<FooterSocialItem>;
  };
  payments: {
    showPayments: boolean;
  };
  copyright: {
    showCopyright: boolean;
    text: string; // empty → auto "© YYYY {company.name}"
  };
}

export function buildFooterDefaultContent(): FooterBlockContent {
  return {
    brand: {
      showBrand: true,
      logoUrl: BRAND_INFO.logoUrl,
      name: BRAND_INFO.name,
      subtitle: BRAND_INFO.subtitle,
      description: BRAND_INFO.description,
    },
    company: {
      showCompany: true,
      name: COMPANY_INFO.name,
      unp: COMPANY_INFO.unp,
      legalAddress: COMPANY_INFO.legalAddress,
      mailingAddress: COMPANY_INFO.mailingAddress,
      phone: COMPANY_INFO.phone,
      phoneHref: COMPANY_INFO.phoneHref,
      email: COMPANY_INFO.email,
      workHours: COMPANY_INFO.workHours,
    },
    navigation: {
      showNavigation: true,
      title: "Навигация",
      items: NAV_LINKS.map((i) => ({ ...i })),
    },
    legal: {
      showLegal: true,
      title: "Документы",
      items: LEGAL_LINKS.map((i) => ({ ...i })),
    },
    social: {
      showSocial: false,
      title: "Мы в соцсетях",
      items: [],
    },
    payments: {
      showPayments: true,
    },
    copyright: {
      showCopyright: true,
      text: "",
    },
  };
}
