import { supabase } from "@/integrations/supabase/client";
import { SiteEventService } from "./SiteEventService";
import type { SitePageTag, SitePageTagLink } from "./types";

const SOURCE = "site-builder";

async function getCurrentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data?.user?.id) throw new Error("Not authenticated");
  return data.user.id;
}

async function writeAudit(action: string, userId: string, meta: Record<string, unknown>) {
  await (supabase.from("audit_logs") as any).insert({
    action,
    actor_type: "user",
    actor_user_id: userId,
    actor_label: SOURCE,
    meta,
  });
}

/**
 * SiteTagService — CRUD for page tags.
 * All state-changing operations follow: emitEvent() → DB → recordExecution() → writeAudit().
 *
 * Architecture Decision: site_page_tag_links is a link-table exception —
 * no public_id, metadata, created_by/updated_by. Pure junction storing (page_id, tag_id).
 * Business events are written here, not by the link table itself.
 */
export class SiteTagService {
  static async listTags(): Promise<SitePageTag[]> {
    const { data, error } = await (supabase
      .from("site_page_tags") as any)
      .select("*")
      .order("name");

    if (error) throw new Error(`Failed to list tags: ${error.message}`);
    return (data || []) as SitePageTag[];
  }

  static async getPageTags(pageId: string): Promise<SitePageTag[]> {
    const { data, error } = await (supabase
      .from("site_page_tag_links") as any)
      .select("tag_id, site_page_tags(*)")
      .eq("page_id", pageId);

    if (error) throw new Error(`Failed to get page tags: ${error.message}`);
    return (data || []).map((row: any) => row.site_page_tags).filter(Boolean) as SitePageTag[];
  }

  static async getPageTagLinks(pageId: string): Promise<SitePageTagLink[]> {
    const { data, error } = await (supabase
      .from("site_page_tag_links") as any)
      .select("*")
      .eq("page_id", pageId);

    if (error) throw new Error(`Failed to get page tag links: ${error.message}`);
    return (data || []) as SitePageTagLink[];
  }

  static async createTag(name: string): Promise<SitePageTag> {
    const userId = await getCurrentUserId();

    const eventId = await SiteEventService.emitEvent(
      "site.tag.created", SOURCE, "new",
      { actor_user_id: userId, actor_type: "user", name }
    );

    const { data, error } = await (supabase
      .from("site_page_tags") as any)
      .insert({
        name: name.trim(),
        created_by: userId,
        updated_by: userId,
      })
      .select("*")
      .single();

    if (error) {
      await SiteEventService.recordExecution(eventId, "create_tag", "failed", error.message);
      throw new Error(`Failed to create tag: ${error.message}`);
    }

    const tag = data as SitePageTag;
    await SiteEventService.recordExecution(eventId, "create_tag", "success");
    await writeAudit("site.tag.created", userId, { tag_id: tag.id, name: tag.name });

    return tag;
  }

  static async deleteTag(id: string): Promise<void> {
    const userId = await getCurrentUserId();

    const eventId = await SiteEventService.emitEvent(
      "site.tag.deleted", SOURCE, id,
      { actor_user_id: userId, actor_type: "user" }
    );

    const { error } = await (supabase
      .from("site_page_tags") as any)
      .delete()
      .eq("id", id);

    if (error) {
      await SiteEventService.recordExecution(eventId, "delete_tag", "failed", error.message);
      throw new Error(`Failed to delete tag: ${error.message}`);
    }

    await SiteEventService.recordExecution(eventId, "delete_tag", "success");
    await writeAudit("site.tag.deleted", userId, { tag_id: id });
  }

  static async addTagToPage(pageId: string, tagId: string): Promise<void> {
    const userId = await getCurrentUserId();

    // Invariant: page and tag must belong to same workspace
    const [{ data: page, error: pageErr }, { data: tag, error: tagErr }] = await Promise.all([
      (supabase.from("site_pages") as any).select("workspace_id").eq("id", pageId).single(),
      (supabase.from("site_page_tags") as any).select("workspace_id").eq("id", tagId).single(),
    ]);

    if (pageErr || tagErr || !page || !tag) {
      throw new Error("Page or tag not found");
    }
    if (page.workspace_id !== tag.workspace_id) {
      throw new Error("Cannot link page and tag from different workspaces");
    }

    const eventId = await SiteEventService.emitEvent(
      "site.tag.linked", SOURCE, pageId,
      { actor_user_id: userId, actor_type: "user", tag_id: tagId }
    );

    const { error } = await (supabase
      .from("site_page_tag_links") as any)
      .insert({ page_id: pageId, tag_id: tagId });

    if (error) {
      await SiteEventService.recordExecution(eventId, "link_tag", "failed", error.message);
      throw new Error(`Failed to link tag: ${error.message}`);
    }

    await SiteEventService.recordExecution(eventId, "link_tag", "success");
    await writeAudit("site.tag.linked", userId, { page_id: pageId, tag_id: tagId });
  }

  static async removeTagFromPage(pageId: string, tagId: string): Promise<void> {
    const userId = await getCurrentUserId();

    const eventId = await SiteEventService.emitEvent(
      "site.tag.unlinked", SOURCE, pageId,
      { actor_user_id: userId, actor_type: "user", tag_id: tagId }
    );

    const { error } = await (supabase
      .from("site_page_tag_links") as any)
      .delete()
      .eq("page_id", pageId)
      .eq("tag_id", tagId);

    if (error) {
      await SiteEventService.recordExecution(eventId, "unlink_tag", "failed", error.message);
      throw new Error(`Failed to unlink tag: ${error.message}`);
    }

    await SiteEventService.recordExecution(eventId, "unlink_tag", "success");
    await writeAudit("site.tag.unlinked", userId, { page_id: pageId, tag_id: tagId });
  }
}
