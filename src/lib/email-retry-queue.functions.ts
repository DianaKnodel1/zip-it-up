import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

export interface RetryQueueItem {
  id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  template_name: string;
  recipient_email: string | null;
  status: string;
  error_message: string | null;
  retry_count: number;
  next_retry_at: string | null;
  retry_reason: string | null;
  created_at: string;
  manual_only: boolean;
}

const TOKEN_TEMPLATES = new Set([
  "signup_confirmation",
  "signup_confirmation_resend",
  "password_reset",
  "reminder_confirm_email",
  "bewerbung_magic_link",
]);

/** Wartende und manuell zu bearbeitende Einträge der Nachversand-Warteschlange. */
export const listRetryQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ waiting: RetryQueueItem[]; manual: RetryQueueItem[] }> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;

    const since = new Date(Date.now() - 72 * 3600_000).toISOString();
    const { data: rows, error } = await sb
      .from("email_send_log")
      .select("id, tenant_id, template_name, recipient_email, status, error_message, retry_count, next_retry_at, retry_reason, created_at, rendered_html, metadata")
      .in("status", ["pending", "failed", "skipped", "dlq"])
      .is("acknowledged_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const tenantIds = Array.from(new Set((rows ?? []).map((r: any) => r.tenant_id).filter(Boolean)));
    const names = new Map<string, string>();
    if (tenantIds.length) {
      const { data: tenants } = await sb.from("tenants").select("id, name").in("id", tenantIds);
      for (const t of tenants ?? []) names.set(t.id, t.name);
    }

    const waiting: RetryQueueItem[] = [];
    const manual: RetryQueueItem[] = [];
    for (const r of (rows ?? []) as any[]) {
      const manualOnly =
        r.status === "dlq" ||
        (r.retry_count ?? 0) >= 5 ||
        TOKEN_TEMPLATES.has(r.template_name) ||
        !r.rendered_html;
      const item: RetryQueueItem = {
        id: r.id,
        tenant_id: r.tenant_id ?? null,
        tenant_name: r.tenant_id ? (names.get(r.tenant_id) ?? null) : null,
        template_name: r.template_name,
        recipient_email: r.recipient_email ?? null,
        status: r.status,
        error_message: r.error_message ?? null,
        retry_count: r.retry_count ?? 0,
        next_retry_at: r.next_retry_at ?? null,
        retry_reason: r.retry_reason ?? (r.metadata as any)?.skip_reason ?? null,
        created_at: r.created_at,
        manual_only: manualOnly,
      };
      (manualOnly ? manual : waiting).push(item);
    }
    return { waiting, manual };
  });

/** Startet einen Warteschlangen-Lauf (optional gezielt für einen Eintrag/Mandanten). */
export const runRetryQueueNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      log_id: z.string().uuid().optional(),
      tenant_id: z.string().uuid().optional(),
      dry_run: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).parse(input ?? {})
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { callRetryQueue } = await import("./email-retry-queue.server");
    return await callRetryQueue({
      log_id: data.log_id,
      tenant_id: data.tenant_id,
      dry_run: data.dry_run === true,
      limit: data.limit,
    });
  });

/** Nimmt einen Eintrag aus der Warteschlange (als erledigt markieren). */
export const cancelRetryEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ log_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("email_send_log")
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: context.userId,
        next_retry_at: null,
        retry_locked_until: null,
      })
      .eq("id", data.log_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });