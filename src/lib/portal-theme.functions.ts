// Schreibt das gewählte Portal-Design (Login/Registrierung) auf den Tenant.
// Wird aus dem Landing-Generator beim Speichern einer Fast-Track-Landing aufgerufen.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  tenant_id: z.string().uuid(),
  portal_theme: z.enum(["clean", "office", "atmosphere"]),
});

export const setTenantPortalTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }) => {
    const { data: role, error: roleError } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError) throw new Error(roleError.message);
    if (!role) throw new Error("Nicht autorisiert");

    const { error } = await context.supabase
      .from("tenants")
      .update({ portal_theme: data.portal_theme })
      .eq("id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
