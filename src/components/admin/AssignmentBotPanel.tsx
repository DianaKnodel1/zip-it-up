// Zeigt den Bot-Lauf zu einer Zuweisung, die WebID-Checkliste und die Freigabe.
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bot, CheckCircle2, Circle, Loader2, PlayCircle, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { getRunForAssignment, releaseAssignment, startRunForAssignment } from "@/lib/bots.functions";

const RUN_LABEL: Record<string, string> = {
  queued: "Wartet auf IP-Zuweisung",
  running: "Antrag wird ausgefüllt...",
  waiting_admin: "Identifizierung / Legitimation erforderlich",
  done: "Abgeschlossen",
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
};

interface Props {
  assignmentId: string;
  caseNumber: string;
  status: string;
  webId: { enabled: boolean; clientName: string; startUrl: string };
  onChanged: () => void;
}

export function AssignmentBotPanel({ assignmentId, caseNumber, status, webId, onChanged }: Props) {
  const { toast } = useToast();
  const getRun = useServerFn(getRunForAssignment);
  const startRun = useServerFn(startRunForAssignment);
  const release = useServerFn(releaseAssignment);

  const [run, setRun] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [nr, setNr] = useState(caseNumber);

  const load = useCallback(async () => {
    try {
      const res = await getRun({ data: { assignment_id: assignmentId } });
      setRun(res.run);
    } catch { /* Panel bleibt leer */ }
  }, [assignmentId, getRun]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setNr(caseNumber); }, [caseNumber]);

  // Solange der Lauf aktiv ist, Status regelmäßig nachladen.
  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status)) return;
    const t = setInterval(() => { void load(); }, 8000);
    return () => clearInterval(t);
  }, [run, load]);

  const handleStart = async () => {
    setBusy(true);
    try {
      const res = await startRun({ data: { assignment_id: assignmentId } });
      if (!res.ok) toast({ title: "Kein Bot-Lauf", description: res.error, variant: "destructive" });
      else { toast({ title: "Bot-Lauf gestartet" }); await load(); onChanged(); }
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const handleRelease = async () => {
    setBusy(true);
    try {
      const res = await release({ data: { assignment_id: assignmentId, case_number: nr.trim() } });
      if (!res.ok) toast({ title: "Freigabe nicht möglich", description: res.error, variant: "destructive" });
      else { toast({ title: "Auftrag freigegeben", description: "Der Mitarbeiter sieht den Auftrag jetzt." }); onChanged(); }
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const check = (ok: boolean, label: string) => (
    <div className="flex items-center gap-2 text-xs">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-accent" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
      <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4" /> Bot-Lauf & Freigabe</CardTitle>
        <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1.5" onClick={handleStart} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
          Lauf starten
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {run ? (
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Status</span>
              <Badge variant="secondary">{RUN_LABEL[run.status] ?? run.status}</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Fortschritt</span>
              <span>Schritt {run.current_step} von {run.total_steps}</span>
            </div>
            {run.handoff_reason && (
              <p className="text-xs text-muted-foreground">Übergabe: {run.handoff_reason}</p>
            )}
            {run.handoff_url && (
              <a href={run.handoff_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
                Sitzung im Browser öffnen
              </a>
            )}
            {run.last_error && <p className="text-xs text-destructive">Fehler: {run.last_error}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Noch kein Lauf gestartet. Der Bot füllt den Bank-Antrag (Consorsbank, Deutsche Bank, DKB, comdirect, Santander) automatisch aus.
            </p>
            <p className="text-[11px] text-muted-foreground italic">
              * Die Vorgangsnummer (TID) wird nach erfolgreicher Kontoerstellung automatisch ausgelesen. Der Bot arbeitet vollautomatisch bis zu diesem Punkt. Sobald die Nummer vorliegt, stoppt der Bot, damit die Legitimation (Ausweis-Check/VideoIdent) manuell geprüft oder freigegeben werden kann. Der Ausweis-Check erfolgt erst nach Erstellung der Vorgangsnummer.
            </p>
          </div>
        )}

        <div className="rounded-md border p-3 space-y-1.5">
          <p className="text-xs font-medium flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> WebID-Checkliste</p>
          {check(webId.enabled, "WebID-Modul für diese Firma aktiv")}
          {check(Boolean(webId.clientName), "Auftraggeber hinterlegt")}
          {check(Boolean(webId.startUrl), "Start-URL hinterlegt")}
          {check(Boolean(nr.trim()), "Vorgangsnummer vorhanden")}
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Vorgangsnummer</label>
            <Input value={nr} onChange={(e) => setNr(e.target.value)} placeholder="z. B. 4711-AB" className="h-8 text-sm" />
          </div>
          <Button size="sm" className="h-8" onClick={handleRelease} disabled={busy || !nr.trim() || status !== "entwurf"}>
            Freigeben
          </Button>
        </div>
        {status !== "entwurf" && (
          <p className="text-[11px] text-muted-foreground">Der Auftrag ist bereits freigegeben und für den Mitarbeiter sichtbar.</p>
        )}
      </CardContent>
    </Card>
  );
}
