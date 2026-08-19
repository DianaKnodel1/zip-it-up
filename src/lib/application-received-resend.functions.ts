// Nachversand der Eingangsbestätigung ("Bewerbung eingegangen").
//
// Der generische Resend über email-resend spielt das gespeicherte HTML noch
// einmal ab. Scheitert der Erstversand aber schon am Gateway (502 o.ä.), gibt
// es gar kein gerendertes HTML — der Knopf lief damit ins Leere. Diese
// Funktion baut die Mail komplett neu auf (inkl. frischem Buchungslink) und
// stößt denselben Versandweg an wie die öffentliche Bewerbungs-Route.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const resendApplicationReceived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ applicationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase
      .from("user_roles").select("role")
      .eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    if (!role) throw new Error("Nicht autorisiert");

    const { resendApplicationReceivedMail } = await import("./application-received-resend.server");
    return await resendApplicationReceivedMail(data.applicationId);
  });
