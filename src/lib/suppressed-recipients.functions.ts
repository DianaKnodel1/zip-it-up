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

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export interface SuppressedRecipient {
  recipient_email: string;
  tenant_id: string | null;
  tenant_name: string | null;
  consecutive_failures: number;
  last_failed_at: string | null;
  last_error: string | null;
  suppressed_at: string;
}

export const listSuppressedRecipients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: SuppressedRecipient[] }> => {
    await assertAdmin(context);
    const sb = await getAdmin();
    const { data: rows, error } = await sb
      .from("email_recipient_failures")
      .select("recipient_email, tenant_id, consecutive_failures, last_failed_at, last_error, suppressed_at")
      .not("suppressed_at", "is", null)
      .order("suppressed_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const tenantIds = Array.from(new Set((rows ?? []).map((r: any) => r.tenant_id).filter(Boolean)));
    const nameMap = new Map<string, string>();
    if (tenantIds.length) {
      const { data: tenants } = await sb.from("tenants").select("id, name").in("id", tenantIds);
      for (const t of tenants ?? []) nameMap.set(t.id, t.name);
    }
    return {
      rows: (rows ?? []).map((r: any) => ({
        recipient_email: r.recipient_email,
        tenant_id: r.tenant_id ?? null,
        tenant_name: r.tenant_id ? (nameMap.get(r.tenant_id) ?? null) : null,
        consecutive_failures: r.consecutive_failures ?? 0,
        last_failed_at: r.last_failed_at ?? null,
        last_error: r.last_error ?? null,
        suppressed_at: r.suppressed_at,
      })),
    };
  });

export const unsuppressRecipient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ recipient_email: z.string().email(), tenant_id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await getAdmin();
    const key = data.recipient_email.toLowerCase().trim();
    const { error } = await sb
      .from("email_recipient_failures")
      .update({ suppressed_at: null, consecutive_failures: 0, updated_at: new Date().toISOString() })
      .eq("recipient_email", key)
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    // Zusätzlich: falls Adresse als "manuell" in suppressed_emails liegt → entfernen
    await sb.from("suppressed_emails").delete().ilike("email", key);
    return { ok: true };
  });

/**
 * Manuelle Sperre einer E-Mail-Adresse durch Admin.
 * Blockiert:
 *   - alle künftigen App-Mails (Trigger auto_suppress + suppressed_emails)
 *   - Neu-Registrierung mit dieser Adresse (Check in send-signup-confirmation)
 */
export const blockRecipient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      recipient_email: z.string().email(),
      reason: z.string().max(200).optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await getAdmin();
    const key = data.recipient_email.toLowerCase().trim();
    const reason = data.reason?.trim() || "Manuell gesperrt durch Admin";
    const now = new Date().toISOString();

    // 1. Globale manuelle Sperre. Automatische Empfängerfehler sind dagegen
    // bewusst mandantenbezogen in email_recipient_failures gespeichert.
    const { data: existingSup } = await sb
      .from("suppressed_emails").select("id").is("tenant_id", null).ilike("email", key).maybeSingle();
    if (existingSup) {
      await sb.from("suppressed_emails")
        .update({ reason: `manual:${reason}`, source: "admin" })
        .eq("id", existingSup.id);
    } else {
      await sb.from("suppressed_emails")
        .insert({ tenant_id: null, email: key, reason: `manual:${reason}`, source: "admin" });
    }


    // 2. Wenn ein Account mit dieser Adresse existiert → sperren (Login unmöglich)
    try {
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list?.users.find((u: any) => (u.email ?? "").toLowerCase() === key);
      if (existing) {
        await sb.auth.admin.updateUserById(existing.id, {
          ban_duration: "876000h", // ~100 Jahre
          user_metadata: { ...(existing.user_metadata || {}), blocked_reason: reason, blocked_at: now },
        });
      }
    } catch (e) {
      console.warn("block existing auth user failed:", e);
    }

    return { ok: true };
  });

