/**
 * Page-binding config for public product pages.
 * 
 * This is NOT the source of truth for products — that's the database (products_v2).
 * This config maps page routes to their canonical product codes for explicit binding,
 * so that tariffs load correctly on preview, localhost, and any temporary domain.
 * 
 * To add a new product page: add one entry here with its DB-confirmed unique `code`.
 */
export const PRODUCT_PAGES = {
  /** Gorbova Club — main subscription club */
  club: { code: "club" },
  /** Платная консультация — one-time consultation service */
  consultation: { code: "consultation" },
  /** Бухгалтерия как бизнес — monthly business training */
  businessTraining: { code: "buh_business" },
} as const;

/** Type for product page keys */
export type ProductPageKey = keyof typeof PRODUCT_PAGES;
