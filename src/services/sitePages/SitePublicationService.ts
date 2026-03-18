import { supabase } from "@/integrations/supabase/client";
import { SiteEventService } from "./SiteEventService";
import { siteBlockSchema, type SitePage, type SiteDomainBinding } from "./types";

const SOURCE = "site-builder";

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
 * SitePublicationService — publish/unpublish pages and manage domain bindings.
 * All state transitions go through domain events.
 */
export class SitePublicationService {
  static async publish(pageId: string): Promise<SitePage> {
    const userId = await getCurrentUserId();

    // Fetch page to validate
    const { data: page, error: fetchError } = await supabase
      .from("site_pages")
      .select("*")
      .eq("id", pageId)
      .single();

    if (fetchError || !page) throw new Error("Page not found");

    const blocks = (page.blocks as unknown as Record<string, unknown>[]) || [];
    if (blocks.length === 0) {
      throw new Error("Cannot publish: page has no blocks");
    }

    // Validate all blocks
    for (const block of blocks) {
      const result = siteBlockSchema.safeParse(block);
      if (!result.success) {
        throw new Error(`Cannot publish: invalid block — ${result.error.message}`);
      }
    }

    // Emit event
    const eventId = await SiteEventService.emitEvent(
      "site.page.published", SOURCE, pageId,
      { actor_user_id: userId, actor_type: "user" }
    );

    // Execute: set status
    const { data: updated, error: updateError } = await supabase
      .from("site_pages")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq("id", pageId)
      .select("*")
      .single();

    if (updateError) {
      await SiteEventService.recordExecution(eventId, "publish_page", "failed", updateError.message);
      throw new Error(`Failed to publish: ${updateError.message}`);
    }

    await SiteEventService.recordExecution(eventId, "publish_page", "success");
    await writeAudit("site.page.published", userId, { page_id: pageId });

    return updated as unknown as SitePage;
  }

  static async unpublish(pageId: string): Promise<SitePage> {
    const userId = await getCurrentUserId();

    const eventId = await SiteEventService.emitEvent(
      "site.page.unpublished", SOURCE, pageId,
      { actor_user_id: userId, actor_type: "user" }
    );

    const { data, error } = await supabase
      .from("site_pages")
      .update({
        status: "draft",
        published_at: null,
        updated_by: userId,
      })
      .eq("id", pageId)
      .select("*")
      .single();

    if (error) {
      await SiteEventService.recordExecution(eventId, "unpublish_page", "failed", error.message);
      throw new Error(`Failed to unpublish: ${error.message}`);
    }

    await SiteEventService.recordExecution(eventId, "unpublish_page", "success");
    await writeAudit("site.page.unpublished", userId, { page_id: pageId });

    return data as unknown as SitePage;
  }

  static async bindDomain(pageId: string, domain: string): Promise<SiteDomainBinding> {
    const userId = await getCurrentUserId();

    // Emit event first (intent)
    const bindingId = crypto.randomUUID();
    const eventId = await SiteEventService.emitEvent(
      "site.domain.bound", SOURCE, bindingId,
      { actor_user_id: userId, actor_type: "user", page_id: pageId, domain }
    );

    // Execute: insert binding with full entity contract
    const { data, error } = await supabase
      .from("site_domain_bindings")
      .insert({
        id: bindingId,
        site_page_id: pageId,
        domain,
        is_primary: false,
        created_by: userId,
        metadata: {},
      })
      .select("*")
      .single();

    if (error) {
      await SiteEventService.recordExecution(eventId, "insert_binding", "failed", error.message);
      throw new Error(`Failed to bind domain: ${error.message}`);
    }

    await SiteEventService.recordExecution(eventId, "insert_binding", "success");
    await writeAudit("site.domain.bound", userId, { binding_id: bindingId, page_id: pageId, domain });

    return data as unknown as SiteDomainBinding;
  }

  static async unbindDomain(bindingId: string): Promise<void> {
    const userId = await getCurrentUserId();

    const eventId = await SiteEventService.emitEvent(
      "site.domain.unbound", SOURCE, bindingId,
      { actor_user_id: userId, actor_type: "user" }
    );

    const { error } = await supabase
      .from("site_domain_bindings")
      .delete()
      .eq("id", bindingId);

    if (error) {
      await SiteEventService.recordExecution(eventId, "delete_binding", "failed", error.message);
      throw new Error(`Failed to unbind domain: ${error.message}`);
    }

    await SiteEventService.recordExecution(eventId, "delete_binding", "success");
    await writeAudit("site.domain.unbound", userId, { binding_id: bindingId });
  }

  static async listBindings(pageId: string): Promise<SiteDomainBinding[]> {
    const { data, error } = await supabase
      .from("site_domain_bindings")
      .select("*")
      .eq("site_page_id", pageId)
      .order("created_at");

    if (error) throw new Error(`Failed to list bindings: ${error.message}`);
    return (data || []) as unknown as SiteDomainBinding[];
  }
}
