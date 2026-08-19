// Public lookup: Bewerber gibt seine E-Mail ein → wir prüfen, ob es eine
// Bewerbung gibt. Wenn ja, erzeugen/erneuern wir einen Magic-Link und leiten
// direkt ins Bewerbungsgespräch. Calendly wurde bereits im Vermittlungsflow
// gebucht und wird hier bewusst NICHT mehr geöffnet.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const Schema = z.object({
  email: z.string().trim().email().max(255),
  portal_url: z.string().url().max(500).optional().nullable(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export const Route = createFileRoute("/api/public/application-lookup")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let payload: unknown;
        try { payload = await request.json(); } catch { return json({ error: "Ungültige Anfrage (JSON konnte nicht gelesen werden)." }, 400); }
        const parsed = Schema.safeParse(payload);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          return json({ error: `Ungültige E-Mail-Adresse: ${first?.message ?? "bitte prüfen"}` }, 400);
        }

        const email = parsed.data.email.toLowerCase();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Bewerbungen zu dieser E-Mail laden. Wichtig: Es kann Duplikate geben
        // (z.B. Formular-Submit + Calendly-Webhook). Deshalb nicht blind die
        // neueste Zeile nehmen, sondern bevorzugt eine Zeile mit gebuchtem Termin.
        const { data: apps, error } = await supabaseAdmin
          .from("applications")
          .select("id, full_name, email, phone, source_slug, source_landing_id, target_landing_id, booking_status, scheduled_at, calendly_event_uri, calendly_invitee_uri, tenant_id, created_at, magic_token, magic_token_expires_at")
          .ilike("email", email)
          .order("created_at", { ascending: false })
          .limit(10);

        if (error) {
          console.error("[application-lookup]", error);
          return json({ error: `Datenbank-Abfrage fehlgeschlagen: ${error.message || "unbekannter Fehler"}` }, 500);
        }
        const bookedStatuses = new Set(["scheduled", "completed", "booked", "gebucht", "bestätigt", "bestaetigt", "abgeschlossen"]);
        const isBooked = (row: any) => {
          const status = String(row?.booking_status || "").toLowerCase().trim();
          return bookedStatuses.has(status) || !!row?.scheduled_at || !!row?.calendly_invitee_uri || !!row?.calendly_event_uri;
        };

        const rows = (apps ?? []) as any[];
        const app = rows.find(isBooked) ?? rows[0];
        if (!app) {
          return json({
            found: false,
            reason: "no_application",
            message: `Zu der E-Mail-Adresse "${email}" liegt uns keine Bewerbung vor. Bitte prüfe die Schreibweise – verwende die exakte Adresse, mit der du dich beworben hast. Falls du dich noch nicht beworben hast, mach das zuerst über die Landing-Page.`,
          });
        }

        const landingSelect = "id, calendly_url, slug, source_slug, flow_type, domain, linked_fasttrack_landing_id, booking_mode";
        const loadLandingById = async (id?: string | null) => {
          if (!id) return null;
          const { data } = await supabaseAdmin
            .from("landing_pages")
            .select(landingSelect)
            .eq("id", id)
            .maybeSingle();
          return data as any | null;
        };
        const loadLandingBySlug = async (slug?: string | null) => {
          const s = String(slug || "").trim();
          if (!s) return null;
          const { data: bySource } = await supabaseAdmin
            .from("landing_pages")
            .select(landingSelect)
            .eq("source_slug", s)
            .eq("is_published", true)
            .maybeSingle();
          if (bySource) return bySource as any;
          const { data: bySlug } = await supabaseAdmin
            .from("landing_pages")
            .select(landingSelect)
            .eq("slug", s)
            .eq("is_published", true)
            .maybeSingle();
          return bySlug as any | null;
        };
        const followFasttrack = async (lp: any | null) => {
          if (!lp) return null;
          const linkedId = lp.linked_fasttrack_landing_id ?? null;
          if (linkedId) {
            const linked = await loadLandingById(linkedId);
            if (linked) return linked;
          }
          return lp;
        };

        // Landing-Info robust auflösen: alte Datensätze haben oft nur source_slug,
        // neue Vermittlungen zusätzlich source_landing_id/target_landing_id.
        const originLanding =
          (await loadLandingById(app.source_landing_id))
          || (await loadLandingBySlug(app.source_slug))
          || (await loadLandingById(app.target_landing_id));
        const targetLanding = await followFasttrack(
          (await loadLandingById(app.target_landing_id))
          || (await loadLandingById(app.source_landing_id))
          || (await loadLandingBySlug(app.source_slug))
        );
        const landingSlug: string | null = targetLanding?.slug ?? app.source_slug ?? null;

        const booked = isBooked(app);
        let magicToken: string | null = app.magic_token ?? null;
        // Bewerbungs-/Interview-Magic-Links laufen bewusst NICHT ab.
        if (!magicToken) {
          magicToken = `${crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;
          const { error: tokenError } = await supabaseAdmin
            .from("applications")
            .update({
              magic_token: magicToken,
              magic_token_expires_at: null,
              target_landing_id: targetLanding?.id ?? app.target_landing_id ?? null,
            } as any)
            .eq("id", app.id);
          if (tokenError) {
            console.error("[application-lookup] token update failed", tokenError);
            return json({ error: "Bewerbungslink konnte nicht erstellt werden." }, 500);
          }
        }
        const base = (parsed.data.portal_url || new URL(request.url).origin).replace(/\/+$/, "");

        // Ohne Termin haengt der naechste Schritt an der Buchungsart der
        // Landing: 'calendly' hat keinen internen Kalender — dort wuerde die
        // Terminauswahl "Buchung derzeit nicht moeglich" zeigen.
        if (!booked) {
          const bookingLanding = originLanding ?? targetLanding;
          const bookingMode = String((bookingLanding as any)?.booking_mode ?? "calendly");
          if (bookingMode === "calendly") {
            const calBase = String((bookingLanding as any)?.calendly_url ?? "").trim();
            if (!calBase) {
              return json({
                found: true,
                booked: false,
                reason: "calendly_missing",
                message:
                  "Ihre Bewerbung liegt uns vor, die Terminbuchung ist aber gerade nicht verfügbar. Bitte antworten Sie kurz auf Ihre Bewerbungs-E-Mail — wir melden uns umgehend mit einem Termin.",
              });
            }
            const parts = String(app.full_name ?? "").trim().split(/\s+/).filter(Boolean);
            const firstName = parts[0] ?? "";
            const lastName = parts.slice(1).join(" ");
            const sep = calBase.includes("?") ? "&" : "?";
            const qs = new URLSearchParams({
              name: app.full_name ?? "",
              email: app.email ?? email,
              first_name: firstName,
              last_name: lastName,
              utm_content: app.id,
              utm_source: app.source_slug ?? "",
            });
            if (app.phone) qs.set("a1", String(app.phone));
            return json({
              found: true,
              booked: false,
              interview_ready: true,
              landing_slug: landingSlug,
              redirect_url: `${calBase}${sep}${qs.toString()}`,
              message: "Ihre Bewerbung wurde gefunden. Sie werden jetzt zur Terminbuchung weitergeleitet.",
            });
          }
        }

        // Ohne gebuchten Termin führt die E-Mail-Eingabe direkt zur
        // Terminauswahl, sonst ins Bewerbungsgespräch.
        const redirectUrl = booked
          ? `${base}/bewerbung?token=${encodeURIComponent(magicToken)}`
          : `${base}/termin/buchen/${encodeURIComponent(magicToken)}`;
        return json({
          found: true,
          booked,
          interview_ready: true,
          landing_slug: landingSlug,
          redirect_url: redirectUrl,
          message: booked
            ? "Dein Termin ist bestätigt. Du wirst jetzt zum Bewerbungsgespräch weitergeleitet."
            : "Deine Bewerbung wurde gefunden. Du wirst jetzt zur Terminauswahl weitergeleitet.",
        });
      },
    },
  },
});
