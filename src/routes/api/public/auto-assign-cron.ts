import { createFileRoute } from "@tanstack/react-router";

// Weist anstehenden Terminen automatisch einen Auftrag zu, wenn 15 Minuten
// vor Terminbeginn noch keiner zugewiesen ist.
// Aufruf minütlich via Cron:
//   * * * * * curl -fsS "https://mb-portal.com/api/public/auto-assign-cron?key=<CRON_SECRET>" >/dev/null

export const Route = createFileRoute("/api/public/auto-assign-cron")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const key = url.searchParams.get("key");
        const expected = process.env.CRON_SECRET;
        if (!expected || key !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const { runAutoAssignCycle } = await import("@/lib/auto-assign.server");
          const result = await runAutoAssignCycle();
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
