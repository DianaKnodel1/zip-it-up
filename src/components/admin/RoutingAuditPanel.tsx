import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { runRoutingAudit } from "@/lib/routing-audit.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlayCircle, CheckCircle2, AlertTriangle } from "lucide-react";

type Candidate = { application_id?: string; profile_id?: string; to?: string; reason?: string; extra?: any };
type Report = { key: string; label: string; source: string; ok: boolean; candidates: Candidate[]; note?: string; error?: string };

export function RoutingAuditPanel() {
  const run = useServerFn(runRoutingAudit);
  const [loading, setLoading] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [ts, setTs] = useState<string>("");

  async function onRun() {
    setLoading(true);
    try {
      const res = await run({ data: {} } as any);
      setReports(res.reports);
      setTs(res.generated_at);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Routing-Audit — wer würde jetzt eine Mail bekommen?</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Prüft READ-ONLY jeden Trigger (Cron + eventgetrieben) und listet die aktuellen Kandidaten. Kein Versand.
          </p>
        </div>
        <Button onClick={onRun} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
          Audit starten
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {ts && <p className="text-xs text-muted-foreground">Stand: {new Date(ts).toLocaleString("de-DE")}</p>}
        {reports.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground">Noch keine Audit-Ergebnisse. Klick auf „Audit starten".</p>
        )}
        {reports.map((r) => (
          <div key={r.key} className="border rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {r.ok ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                <span className="font-medium text-sm">{r.label}</span>
                <Badge variant="outline" className="text-[10px]">{r.source}</Badge>
              </div>
              <Badge variant={r.candidates.length ? "default" : "secondary"}>
                {r.candidates.length} Kandidat(en)
              </Badge>
            </div>
            {r.error && <p className="text-xs text-red-600 mb-2">Fehler: {r.error}</p>}
            {r.note && <p className="text-xs text-muted-foreground mb-2">{r.note}</p>}
            {r.candidates.length > 0 && (
              <div className="text-xs max-h-56 overflow-auto border rounded bg-muted/30">
                <table className="w-full">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="text-left p-1.5">Empfänger</th>
                      <th className="text-left p-1.5">Ref-ID</th>
                      <th className="text-left p-1.5">Info</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.candidates.slice(0, 50).map((c, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-1.5 font-mono">{c.to ?? "—"}</td>
                        <td className="p-1.5 font-mono text-[10px]">{c.application_id ?? c.profile_id ?? "—"}</td>
                        <td className="p-1.5">{c.reason ?? ""} {c.extra ? <span className="text-muted-foreground">· {JSON.stringify(c.extra)}</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {r.candidates.length > 50 && (
                  <p className="p-1.5 text-muted-foreground">… {r.candidates.length - 50} weitere</p>
                )}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
