import { z } from "zod";

// ─── Universal Block Settings ───

export const blockSettingsSchema = z.object({
  paddingTop: z.number().default(0),
  paddingBottom: z.number().default(0),
  backgroundColor: z.string().default(""),
  backgroundImage: z.string().default(""),
  textColor: z.string().default(""),
  fullWidth: z.boolean().default(false),
  maxWidth: z.enum(["sm", "md", "lg", "xl", "full"]).default("lg"),
  hideOnMobile: z.boolean().default(false),
  hideOnDesktop: z.boolean().default(false),
  // ─── Site Builder Sprint v2 ───
  // anchorId: slug (a-z, 0-9, '-'), unique per page (валидируется в SitePageService.save)
  anchorId: z.string().default(""),
  // initialVisibility: первичное состояние блока на странице. runtime show/toggle меняют его.
  initialVisibility: z.enum(["visible", "hidden"]).default("visible"),
}).default({});

export type BlockSettings = z.infer<typeof blockSettingsSchema>;

export const blockMetadataSchema = z.record(z.unknown()).default({});

// ─── Existing Block Content Schemas ───

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

// ─── New Block Content Schemas (12) ───

export const videoContentSchema = z.object({
  url: z.string().default(""),
  autoplay: z.boolean().default(false),
  aspectRatio: z.enum(["16:9", "4:3", "1:1"]).default("16:9"),
});

// Canonical button action types. Target ключ — ТОЛЬКО stable block.id (UUID) или anchorId.
// Запрещены: title/name/index/order. Backward-compat: тип 'link' (default) использует поле link.
export const BUTTON_ACTION_TYPES = ["link", "scroll_to_anchor", "show_block", "toggle_block", "open_form"] as const;
export type ButtonActionType = typeof BUTTON_ACTION_TYPES[number];

export const buttonActionSchema = z.object({
  type: z.enum(BUTTON_ACTION_TYPES).default("link"),
  // target — anchorId (для scroll_to_anchor) или block.id (для show/toggle/open_form)
  target: z.string().default(""),
}).default({ type: "link", target: "" });

export const buttonContentSchema = z.object({
  text: z.string().default(""),
  link: z.string().default(""),
  variant: z.enum(["primary", "secondary", "outline"]).default("primary"),
  size: z.enum(["sm", "md", "lg"]).default("md"),
  alignment: z.enum(["left", "center", "right"]).default("center"),
  action: buttonActionSchema.optional(),
});

export const columnsContentSchema = z.object({
  items: z.array(z.object({
    html: z.string().default(""),
  })).default([{ html: "" }, { html: "" }]),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(2),
  gap: z.number().default(24),
});

export const timerContentSchema = z.object({
  targetDate: z.string().default(""),
  title: z.string().default(""),
  expiredMessage: z.string().default("Время вышло"),
});

export const htmlContentSchema = z.object({
  code: z.string().default(""),
});

export const galleryContentSchema = z.object({
  items: z.array(z.object({
    url: z.string().default(""),
    alt: z.string().default(""),
    caption: z.string().default(""),
  })).default([]),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
  gap: z.number().default(16),
});

export const testimonialsContentSchema = z.object({
  items: z.array(z.object({
    name: z.string().default(""),
    text: z.string().default(""),
    avatar: z.string().default(""),
    role: z.string().default(""),
  })).default([]),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
});

export const pricingContentSchema = z.object({
  product_id: z.string().default(""),
  title: z.string().default(""),
  subtitle: z.string().default(""),
});

export const SOCIAL_PLATFORMS = [
  "telegram", "instagram", "vk", "youtube", "tiktok", "facebook", "whatsapp", "x",
] as const;
export type SocialPlatform = typeof SOCIAL_PLATFORMS[number];

export const socialContentSchema = z.object({
  items: z.array(z.object({
    platform: z.enum(SOCIAL_PLATFORMS).default("telegram"),
    url: z.string().default(""),
    label: z.string().default(""),
  })).default([]),
  alignment: z.enum(["left", "center", "right"]).default("center"),
});

export const logosContentSchema = z.object({
  items: z.array(z.object({
    url: z.string().default(""),
    alt: z.string().default(""),
    linkUrl: z.string().default(""),
  })).default([]),
  logoHeight: z.number().default(48),
  grayscale: z.boolean().default(false),
});

export const spacerContentSchema = z.object({
  height: z.number().default(40),
});

export const formContentSchema = z.object({
  title: z.string().default(""),
  subtitle: z.string().default(""),
  buttonText: z.string().default("Отправить"),
  redirectUrl: z.string().default(""),
  fields: z.array(z.object({
    label: z.string().default(""),
    type: z.enum(["text", "email", "phone", "textarea"]).default("text"),
    required: z.boolean().default(false),
    mapping: z.string().default("none"),
  })).default([]),
  // Auth & CRM settings — persisted in block content, NOT runtime state
  auth_mode: z.boolean().default(false),
  telegram_link: z.boolean().default(false),
  product_binding_enabled: z.boolean().default(false),
  product_id: z.string().default(""),
  tariff_id: z.string().default(""),
  deal_creation_enabled: z.boolean().default(false),
  pipeline_id: z.string().default(""),
  pipeline_stage_id: z.string().default(""),
});

// ─── New Site Builder Block Schemas ───

export const accordionSiteContentSchema = z.object({
  items: z.array(z.object({
    id: z.string().default(""),
    title: z.string().default(""),
    content: z.string().default(""),
  })).default([]),
  allowMultiple: z.boolean().default(false),
});

export const tabsSiteContentSchema = z.object({
  tabs: z.array(z.object({
    id: z.string().default(""),
    title: z.string().default(""),
    content: z.string().default(""),
  })).default([]),
});

export const calloutSiteContentSchema = z.object({
  type: z.enum(["info", "success", "warning", "error", "tip", "quote", "summary"]).default("info"),
  content: z.string().default(""),
  title: z.string().default(""),
});

export const quoteSiteContentSchema = z.object({
  text: z.string().default(""),
  author: z.string().default(""),
  source: z.string().default(""),
});

export const audioSiteContentSchema = z.object({
  url: z.string().default(""),
  title: z.string().default(""),
});

export const embedSiteContentSchema = z.object({
  url: z.string().default(""),
  height: z.number().default(400),
});

// ─── Site Questionnaire (Phase 2) ───
// Тонкий wrapper над training engine. lessonId — UUID urok'а в служебном module
// '__site_questionnaires__'. Editor предоставляет ТОЛЬКО selector/wrapper —
// сам редактор вопросов = canonical lesson_blocks editor (admin/training).
export const siteQuestionnaireContentSchema = z.object({
  lessonId: z.string().default(""),
  title: z.string().default(""),
  subtitle: z.string().default(""),
});

// ─── Block Content Schemas Map ───

export const blockContentSchemas = {
  hero: heroContentSchema,
  text: textContentSchema,
  heading: headingContentSchema,
  image: imageContentSchema,
  features: featuresContentSchema,
  cta: ctaContentSchema,
  faq: faqContentSchema,
  divider: dividerContentSchema,
  video: videoContentSchema,
  button: buttonContentSchema,
  columns: columnsContentSchema,
  timer: timerContentSchema,
  html: htmlContentSchema,
  gallery: galleryContentSchema,
  testimonials: testimonialsContentSchema,
  pricing: pricingContentSchema,
  social: socialContentSchema,
  logos: logosContentSchema,
  spacer: spacerContentSchema,
  form: formContentSchema,
  accordion: accordionSiteContentSchema,
  tabs: tabsSiteContentSchema,
  callout: calloutSiteContentSchema,
  quote: quoteSiteContentSchema,
  audio: audioSiteContentSchema,
  embed: embedSiteContentSchema,
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
  folder_id: string | null;
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
  folder_id?: string | null;
  blocks?: SiteBlock[];
  seo_settings?: Record<string, unknown>;
  theme_settings?: Record<string, unknown>;
}

export interface UpdateSitePageData {
  title?: string;
  slug?: string;
  product_id?: string | null;
  folder_id?: string | null;
  blocks?: SiteBlock[];
  seo_settings?: Record<string, unknown>;
  theme_settings?: Record<string, unknown>;
}

// ─── Folder Types ───

export interface SitePageFolder {
  id: string;
  name: string;
  parent_id: string | null;
  workspace_id: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSiteFolderData {
  name: string;
  parent_id?: string | null;
}

export interface UpdateSiteFolderData {
  name?: string;
  parent_id?: string | null;
  sort_order?: number;
}

// ─── Domain Binding Types ───

export interface SiteDomainBinding {
  id: string;
  public_id: string;
  workspace_id: string;
  site_page_id: string;
  domain: string;
  is_primary: boolean;
  is_home: boolean;
  created_by: string;
  updated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── Tag Types ───

export interface SitePageTag {
  id: string;
  public_id: string;
  workspace_id: string;
  name: string;
  created_by: string;
  updated_by: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Link-table exception to global entity structure.
 * No public_id, metadata, created_by/updated_by — pure junction storing (page_id, tag_id).
 * Business events written by SiteTagService.
 */
export interface SitePageTagLink {
  page_id: string;
  tag_id: string;
  created_at: string;
}
