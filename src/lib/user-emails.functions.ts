import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

/**
 * E-Mail-Adressen aller Login-Konten.
 *
 * `profiles` hat keine E-Mail-Spalte — die Adresse lebt ausschließlich in
 * auth.users. Ohne diese Auflösung bleibt die Spalte in der Mitarbeiterliste
 * leer, sobald keine passende Bewerbung verknüpft ist.
 */
export const listUserEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;

    const users: Array<{ user_id: string; email: string }> = [];
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(error.message);
      const batch: any[] = data?.users ?? [];
      for (const u of batch) {
        if (u?.id && u?.email) users.push({ user_id: String(u.id), email: String(u.email) });
      }
      if (batch.length < 1000) break;
    }
    return { users };
  });
