// Public booking endpoint: erlaubt der Landing-Page (fremde Origin), den
// Terminkalender inline zu rendern und Slots zu buchen — ohne iframe/Redirect
// auf das Portal. Kapselt die vorhandenen RPCs `get_schedule_for_application`,
// `get_free_appointment_slots` und `book_appointment_by_token` per CORS-JSON.
//
// Aktionen via ?action=:
//   GET  ?action=schedule&token=…
//   GET  ?action=slots&schedule_id=…&from=YYYY-MM-DD&to=YYYY-MM-DD
//   POST ?action=book   Body: { token, starts_at, applicant_timezone? }

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

const TokenSchema = z.object({ token: z.string().trim().min(8).max(128) });
const SlotsSchema = z.object({
  schedule_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const BookSchema = z.object({
  token: z.string().trim().min(8).max(128),
  // Postgres/Supabase timestamptz RPCs can serialize with either `Z` or an
  // explicit offset (`+00:00`). Accept every value the browser can parse.
  starts_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "invalid_datetime"),
  applicant_timezone: z.string().max(80).optional(),
});

export const Route = createFileRoute("/api/public/booking")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const action = url.searchParams.get("action") || "";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (action === "schedule") {
          const parsed = TokenSchema.safeParse({ token: url.searchParams.get("token") });
          if (!parsed.success) return json({ ok: false, error: "invalid_token" }, 400);
          const { data: rows, error } = await supabaseAdmin.rpc("get_schedule_for_application", {
            _magic_token: parsed.data.token,
          });
          if (error) return json({ ok: false, error: error.message }, 500);
          const row = (rows as any[])?.[0];
          if (!row) return json({ ok: false, error: "not_found" }, 404);
          if (!row.schedule_id) return json({ ok: false, error: "no_schedule", tenant_name: row.tenant_name }, 404);
          return json({
            ok: true,
            schedule_id: row.schedule_id,
            slot_duration_minutes: row.slot_duration_minutes,
            timezone: row.timezone,
            max_days_ahead: row.max_days_ahead,
            min_notice_hours: row.min_notice_hours,
            tenant_name: row.tenant_name ?? null,
            applicant_first_name: row.applicant_first_name ?? null,
            applicant_email: row.applicant_email ?? null,
            recruiter_name: row.recruiter_name ?? null,
            event_description: row.event_description ?? null,
            booking_window_days: row.booking_window_days ?? 30,
          });
        }

        if (action === "slots") {
          const parsed = SlotsSchema.safeParse({
            schedule_id: url.searchParams.get("schedule_id"),
            from: url.searchParams.get("from"),
            to: url.searchParams.get("to"),
          });
          if (!parsed.success) return json({ ok: false, error: "invalid_params" }, 400);
          const { data: rows, error } = await supabaseAdmin.rpc("get_free_appointment_slots", {
            _schedule_id: parsed.data.schedule_id,
            _from_date: parsed.data.from,
            _to_date: parsed.data.to,
          });
          if (error) return json({ ok: false, error: error.message }, 500);
          return json({
            ok: true,
            slots: ((rows as any[]) ?? []).map((r) => ({ start: r.slot_start, end: r.slot_end })),
          });
        }

        return json({ ok: false, error: "unknown_action" }, 400);
      },

      POST: async ({ request }) => {
        const url = new URL(request.url);
        const action = url.searchParams.get("action") || "";
        if (action !== "book") return json({ ok: false, error: "unknown_action" }, 400);

        let payload: unknown;
        try { payload = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
        const parsed = BookSchema.safeParse(payload);
        if (!parsed.success) return json({ ok: false, error: "invalid_body", details: parsed.error.flatten() }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: rows, error } = await supabaseAdmin.rpc("book_appointment_by_token", {
          _magic_token: parsed.data.token,
          _starts_at: parsed.data.starts_at,
          _applicant_timezone: parsed.data.applicant_timezone ?? undefined,
        });
        if (error) return json({ ok: false, error: error.message }, 500);
        const row = (rows as any[])?.[0];
        if (!row) return json({ ok: false, error: "no_result" }, 500);
        if (row.error) return json({ ok: false, error: row.error as string }, 409);
        return json({
          ok: true,
          appointment_id: row.appointment_id,
          cancel_token: row.cancel_token,
          starts_at: row.starts_at,
          ends_at: row.ends_at,
        });
      },
    },
  },
});
