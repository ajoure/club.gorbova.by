import { supabase } from "@/integrations/supabase/client";
import { DomainEventService } from "@/lib/domain-events";
import type { EmailAccount, EmailAccountSaveInput } from "./types";

/**
 * EmailAccountService — service layer for email account CRUD.
 *
 * SECURITY INVARIANT: list() reads exclusively from email_accounts_safe view.
 * smtp_password NEVER reaches the browser.
 *
 * All mutations follow: emitEvent() → DB operation → recordExecution() → writeAudit()
 */
export class EmailAccountService {
  // ── Helpers ──────────────────────────────────────────────

  private static async getCurrentUser(): Promise<{ id: string; email: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Пользователь не авторизован");
    return { id: user.id, email: user.email || user.id };
  }

  private static async writeAudit(
    action: string,
    userId: string,
    userEmail: string,
    meta: Record<string, unknown>
  ): Promise<void> {
    await (supabase.from("audit_logs") as any).insert({
      action,
      actor_type: "user",
      actor_user_id: userId,
      actor_label: userEmail,
      meta,
    });
  }

  // ── Read ─────────────────────────────────────────────────

  /**
   * List all email accounts using the safe view.
   * INVARIANT: smtp_password is never returned.
   */
  static async list(): Promise<EmailAccount[]> {
    const { data, error } = await (supabase
      .from("email_accounts_safe") as any)
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to list email accounts: ${error.message}`);

    return (data as any[]).map((acc: any) => ({
      ...acc,
      has_password: acc.has_password ?? false,
      use_for: Array.isArray(acc.use_for) ? acc.use_for : [],
    })) as EmailAccount[];
  }

  // ── Save (Create / Update) ──────────────────────────────

  static async save(
    account: Partial<EmailAccount>,
    newSmtpPassword?: string
  ): Promise<void> {
    const user = await this.getCurrentUser();
    const isUpdate = !!account.id;
    const eventType = isUpdate ? "email.account.updated" : "email.account.created";
    const entityId = account.id || "new";

    // 1. Emit domain event
    const eventId = await DomainEventService.emitEvent(
      eventType,
      "email-admin",
      entityId,
      { email: account.email, account_id: account.id || null }
    );

    let executionStatus: "success" | "failed" = "success";
    let executionError: string | undefined;

    try {
      // 2. DB operation
      if (isUpdate) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, created_at, has_password, ...updateData } = account;
        const payload: Record<string, unknown> = { ...updateData };
        if (newSmtpPassword) {
          payload.smtp_password = newSmtpPassword;
        }
        const { error } = await supabase
          .from("email_accounts")
          .update(payload)
          .eq("id", account.id);
        if (error) throw error;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, created_at: _createdAt, has_password: _hp, ...insertData } = account;
        if (!insertData.email) throw new Error("Email обязателен");

        const insertPayload = {
          email: insertData.email,
          display_name: insertData.display_name || null,
          provider: insertData.provider || "smtp",
          smtp_host: insertData.smtp_host || null,
          smtp_port: insertData.smtp_port || 465,
          smtp_encryption: insertData.smtp_encryption || "SSL",
          smtp_username: insertData.smtp_username || insertData.email,
          smtp_password: newSmtpPassword || null,
          from_name: insertData.from_name || null,
          from_email: insertData.from_email || insertData.email,
          reply_to: insertData.reply_to || null,
          is_default: insertData.is_default ?? false,
          is_active: insertData.is_active ?? true,
        };
        const { error } = await supabase.from("email_accounts").insert([insertPayload]);
        if (error) throw error;
      }
    } catch (err) {
      executionStatus = "failed";
      executionError = (err as Error).message;
      throw err;
    } finally {
      // 3. Record execution
      await DomainEventService.recordExecution(eventId, "save_account", executionStatus, executionError);

      // 4. Write audit log
      await this.writeAudit(
        eventType,
        user.id,
        user.email,
        { email: account.email, account_id: account.id || null }
      );
    }
  }

  // ── Remove ──────────────────────────────────────────────

  static async remove(id: string): Promise<void> {
    const user = await this.getCurrentUser();

    // 1. Emit domain event
    const eventId = await DomainEventService.emitEvent(
      "email.account.deleted",
      "email-admin",
      id,
      { account_id: id }
    );

    let executionStatus: "success" | "failed" = "success";
    let executionError: string | undefined;

    try {
      // 2. DB operation
      const { error } = await supabase.from("email_accounts").delete().eq("id", id);
      if (error) throw error;
    } catch (err) {
      executionStatus = "failed";
      executionError = (err as Error).message;
      throw err;
    } finally {
      // 3. Record execution
      await DomainEventService.recordExecution(eventId, "delete_account", executionStatus, executionError);

      // 4. Write audit log
      await this.writeAudit(
        "email.account.deleted",
        user.id,
        user.email,
        { account_id: id }
      );
    }
  }
}
