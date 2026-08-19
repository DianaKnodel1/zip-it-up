import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Server-seitiger Fallback für den SMTP-Test.
 *
 * Warum: Der Browser-Aufruf `supabase.functions.invoke("smtp-test")` scheitert
 * mit „Failed to send a request to the Edge Function“, sobald die Funktion vom
 * Browser aus nicht erreichbar ist (CORS, Netz, veralteter Deploy). Dieser Weg
 * ruft dieselbe Funktion vom Portal-Server aus auf — ohne Browser-Netzpfad.
 */
export const runSmtpTestServerSide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    if (!input || typeof input !== "object" || !("tenant_id" in input) || typeof input.tenant_id !== "string") {
      throw new Error("Ungültige Tenant-ID");
    }
    return { tenant_id: input.tenant_id };
  })
  .handler(async ({ data, context }) => {
    const { data: roleRow, error: roleErr } = await (context.supabase as any)
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Nicht autorisiert");

    const baseUrl = process.env.SUPABASE_URL;
    const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    // Die Edge Function prüft die Admin-Rolle anhand des Benutzer-Tokens –
    // deshalb wird genau der Token des Aufrufers weitergereicht.
    const userToken = (getRequest()?.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!baseUrl || !apiKey || !userToken) {
      return {
        success: false as const,
        error: "Backend-Konfiguration fehlt (URL oder Service-Key) — Prüf-Funktion nicht aufrufbar.",
        errorCode: "CONFIG_ERROR",
        reachable: false,
      };
    }

    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/functions/v1/smtp-test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userToken}`,
          apikey: apiKey,
        },
        body: JSON.stringify({ tenant_id: data.tenant_id }),
      });
      const text = await res.text().catch(() => "");
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!body) {
        // Kommt HTML zurück, hat der Reverse-Proxy vor dem Backend geantwortet –
        // die Prüf-Funktion selbst wurde abgeschnitten. HTML nicht anzeigen.
        const isHtml = /^\s*<(!doctype|html)/i.test(text);
        const snippet = isHtml ? "" : text.replace(/\s+/g, " ").trim().slice(0, 200);
        // 502/504 ohne JSON = die Prüfung wurde von der Laufzeitumgebung
        // abgebrochen, bevor eine Diagnose zurückkam.
        if (res.status === 502 || res.status === 504) {
          return {
            success: false as const,
            error:
              `Der SMTP-Server dieses Mandanten antwortet nicht – die Verbindung blieb hängen, bis der Proxy die Prüfung abgebrochen hat (HTTP ${res.status}). Zu prüfen: Host, Port und Firewall-Freigabe des Mailservers. Die Mail-Pause ist nicht die Ursache.${snippet ? ` Antwort: ${snippet}` : ""}`,
            errorCode: "TIMEOUT",
            reachable: true,
          };
        }
        return {
          success: false as const,
          error: `Prüf-Funktion antwortete unerwartet (HTTP ${res.status}). Vermutlich ist die Backend-Funktion nicht deployed.${snippet ? ` Antwort: ${snippet}` : ""}`,
          errorCode: "FUNCTION_UNREACHABLE",
          reachable: false,
        };
      }
      return { ...body, reachable: true };
    } catch (e: any) {
      return {
        success: false as const,
        error: `Prüf-Funktion nicht erreichbar: ${String(e?.message ?? e)}`,
        errorCode: "FUNCTION_UNREACHABLE",
        reachable: false,
      };
    }
  });