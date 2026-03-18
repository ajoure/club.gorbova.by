import { supabase } from "@/integrations/supabase/client";
import { SiteEventService } from "./SiteEventService";
import { siteBlockSchema, type SitePage, type CreateSitePageData, type UpdateSitePageData, type SiteBlock } from "./types";

const SOURCE = "site-builder";

function validateBlocks(blocks: SiteBlock[]): void {
  for (const block of blocks) {
    const result = siteBlockSchema.safeParse(block);
    if (!result.success) {
      throw new Error(`Invalid block ${block.id || "unknown"}: ${result.error.message}`);
    }
  }
}

async function getCurrentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data?.user?.id) throw new Error("Not authenticated");
  return data.user.id;
}

async function writeAudit(action: string, userId: string, meta: Record<string, unknown>) {
  await supabase.from("audit_logs").insert({
    action,
    actor_type: "user",
    actor_user_id: userId,
    actor_label: SOURCE,
    meta,
  });
}

/**
 * SitePageService — CRUD operations for site pages.
 * Sole location of page business logic.
 */
export class SitePageService {
  static async listPages(): Promise<SitePage[]> {
    const { data, error } = await supabase
      .from("site_pages")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to list pages: ${error.message}`);
    return (data || []) as unknown as SitePage[];
  }

  static async getPage(id: string): Promise<SitePage> {
    const { data, error } = await supabase
      .from("site_pages")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Failed to get page: ${error.message}`);
    return data as unknown as SitePage;
  }

  static async createPage(input: CreateSitePageData): Promise<SitePage> {
    const userId = await getCurrentUserId();
    const blocks = input.blocks || [];
    if (blocks.length > 0) validateBlocks(blocks);

    const { data, error } = await supabase
      .from("site_pages")
      .insert({
        title: input.title,
        slug: input.slug,
        product_id: input.product_id || null,
        blocks: blocks as unknown as Record<string, unknown>[],
        seo_settings: input.seo_settings || {},
        theme_settings: input.theme_settings || {},
        created_by: userId,
      })
      .select("*")
      .single();

    if (error) throw new Error(`Failed to create page: ${error.message}`);

    const page = data as unknown as SitePage;

    // Event + audit
    const eventId = await SiteEventService.emitEvent(
      "site.page.created", SOURCE, page.id,
      { actor_user_id: userId, actor_type: "user", title: page.title, slug: page.slug }
    );
    await SiteEventService.recordExecution(eventId, "create_page", "success");
    await writeAudit("site.page.created", userId, { page_id: page.id, title: page.title });

    return page;
  }

  static async updatePage(id: string, input: UpdateSitePageData): Promise<SitePage> {
    const userId = await getCurrentUserId();
    if (input.blocks) validateBlocks(input.blocks);

    const updateData: Record<string, unknown> = { updated_by: userId };
    if (input.title !== undefined) updateData.title = input.title;
    if (input.slug !== undefined) updateData.slug = input.slug;
    if (input.product_id !== undefined) updateData.product_id = input.product_id;
    if (input.blocks !== undefined) updateData.blocks = input.blocks as unknown as Record<string, unknown>[];
    if (input.seo_settings !== undefined) updateData.seo_settings = input.seo_settings;
    if (input.theme_settings !== undefined) updateData.theme_settings = input.theme_settings;

    const { data, error } = await supabase
      .from("site_pages")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw new Error(`Failed to update page: ${error.message}`);

    const page = data as unknown as SitePage;

    const eventId = await SiteEventService.emitEvent(
      "site.page.updated", SOURCE, page.id,
      { actor_user_id: userId, actor_type: "user", changes: Object.keys(input) }
    );
    await SiteEventService.recordExecution(eventId, "update_page", "success");
    await writeAudit("site.page.updated", userId, { page_id: page.id, changes: Object.keys(input) });

    return page;
  }

  static async deletePage(id: string): Promise<void> {
    const userId = await getCurrentUserId();

    const eventId = await SiteEventService.emitEvent(
      "site.page.deleted", SOURCE, id,
      { actor_user_id: userId, actor_type: "user" }
    );

    const { error } = await supabase
      .from("site_pages")
      .delete()
      .eq("id", id);

    if (error) {
      await SiteEventService.recordExecution(eventId, "delete_page", "failed", error.message);
      throw new Error(`Failed to delete page: ${error.message}`);
    }

    await SiteEventService.recordExecution(eventId, "delete_page", "success");
    await writeAudit("site.page.deleted", userId, { page_id: id });
  }
}
