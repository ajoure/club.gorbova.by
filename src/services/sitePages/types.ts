import { z } from "zod";

// ─── Block Schema ───

export const blockSettingsSchema = z.record(z.unknown()).default({});
export const blockMetadataSchema = z.record(z.unknown()).default({});

export const heroContentSchema = z.object({
  title: z.string().default(""),
  subtitle: z.string().default(""),
  buttonText: z.string().default(""),
  buttonLink: z.string().default(""),
  backgroundImage: z.string().default(""),
  alignment: z.enum(["left", "center", "right"]).default("center"),
});

export const textContentSchema = z.object({
  html: z.string().default(""),
});

export const headingContentSchema = z.object({
  text: z.string().default(""),
  level: z.number().min(1).max(4).default(2),
});

export const imageContentSchema = z.object({
  url: z.string().default(""),
  alt: z.string().default(""),
  width: z.string().default("100%"),
  linkUrl: z.string().default(""),
});

export const featuresContentSchema = z.object({
  items: z.array(z.object({
    icon: z.string().default(""),
    title: z.string().default(""),
    description: z.string().default(""),
  })).default([]),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
});

export const ctaContentSchema = z.object({
  title: z.string().default(""),
  subtitle: z.string().default(""),
  buttonText: z.string().default(""),
  buttonLink: z.string().default(""),
  backgroundColor: z.string().default(""),
});

export const faqContentSchema = z.object({
  items: z.array(z.object({
    question: z.string().default(""),
    answer: z.string().default(""),
  })).default([]),
});

export const dividerContentSchema = z.object({
  style: z.enum(["line", "spacer"]).default("line"),
  height: z.number().default(1),
});

export const blockContentSchemas = {
  hero: heroContentSchema,
  text: textContentSchema,
  heading: headingContentSchema,
  image: imageContentSchema,
  features: featuresContentSchema,
  cta: ctaContentSchema,
  faq: faqContentSchema,
  divider: dividerContentSchema,
} as const;

export type BlockType = keyof typeof blockContentSchemas;

export const siteBlockSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  version: z.number().int().positive(),
  content: z.record(z.unknown()),
  settings: blockSettingsSchema,
  metadata: blockMetadataSchema,
});

export type SiteBlock = z.infer<typeof siteBlockSchema>;

// ─── Page Types ───

export interface SitePage {
  id: string;
  public_id: string;
  workspace_id: string;
  title: string;
  slug: string;
  product_id: string | null;
  blocks: SiteBlock[];
  seo_settings: Record<string, unknown>;
  theme_settings: Record<string, unknown>;
  status: "draft" | "published";
  published_at: string | null;
  created_by: string;
  updated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateSitePageData {
  title: string;
  slug: string;
  product_id?: string | null;
  blocks?: SiteBlock[];
  seo_settings?: Record<string, unknown>;
  theme_settings?: Record<string, unknown>;
}

export interface UpdateSitePageData {
  title?: string;
  slug?: string;
  product_id?: string | null;
  blocks?: SiteBlock[];
  seo_settings?: Record<string, unknown>;
  theme_settings?: Record<string, unknown>;
}

// ─── Domain Binding Types ───

export interface SiteDomainBinding {
  id: string;
  public_id: string;
  workspace_id: string;
  site_page_id: string;
  domain: string;
  is_primary: boolean;
  created_by: string;
  updated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
