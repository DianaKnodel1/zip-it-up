import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_employee/tasks_/$assignmentId/webid")({
  component: WebIdStationPage,
  head: () => ({
    meta: [
      { title: "WebID-Identifikation – Mitarbeiter-Portal" },
      { name: "description", content: "Identifikation über WebID direkt im Mitarbeiter-Portal starten und abschließen." },
      { property: "og:title", content: "WebID-Identifikation – Mitarbeiter-Portal" },
      { property: "og:description", content: "Identifikation über WebID direkt im Mitarbeiter-Portal starten und abschließen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  buildWebIdStartUrl, WEBID_APP_LINKS, useWebIdEnabled, WEBID_STATUS_LABEL, type WebIdStatus,
} from "@/lib/webid";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Copy, ExternalLink, Loader2,
  RotateCcw, ShieldCheck, Smartphone, Upload,
} from "lucide-react";

interface WebIdAssignmentRow {
  id: string;
  user_id: string;
  webid_client_name: string | null;
  webid_status: string | null;
  webid_start_url: string | null;
  webid_started_at: string | null;
  webid_confirmed_at: string | null;
  individual_case_number: string | null;
  individual_email: string | null;
  individual_password: string | null;
  individual_hint: string | null;
  task_templates: { title: string } | null;
}

const CHECKLIST = [
  "Gültiger Ausweis oder Reisepass liegt bereit",
  "Raum ist gut ausgeleuchtet, keine Spiegelungen",
  "Kamera und Mikrofon funktionieren",
  "Stabile Internetverbindung",
];

function WebIdStationPage() {
  const WEBID_ENABLED = useWebIdEnabled();
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<WebIdAssignmentRow | null>(null);
  const [status, setStatus] = useState<WebIdStatus>("offen");
  const [saving, setSaving] = useState<WebIdStatus | null>(null);
  const [checked, setChecked] = useState<boolean[]>(CHECKLIST.map(() => false));
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!WEBID_ENABLED) return;
    let active = true;
    (async () => {
      if (!assignmentId) return;
      const { data } = await supabase
        .from("task_assignments")
        .select("id, user_id, webid_client_name, webid_status, webid_start_url, webid_started_at, webid_confirmed_at, individual_case_number, individual_email, individual_password, individual_hint, task_templates(title)")
        .eq("id", assignmentId)
        .maybeSingle();
      if (!active) return;
      const rec = (data as unknown as WebIdAssignmentRow) ?? null;
      setRow(rec);
      const s = (rec?.webid_status as WebIdStatus | null) ?? "offen";
      setStatus(s);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [assignmentId]);

  // Modul ist derzeit deaktiviert: Station ist für Mitarbeiter nicht erreichbar.
  if (!WEBID_ENABLED) {
    return (
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">Diese Seite ist derzeit nicht verfügbar.</p>
        <Button variant="outline" onClick={() => navigate("/tasks")}>Zurück zu den Aufträgen</Button>
      </div>
    );
  }

  const copy = (val: string, label: string) => {
    navigator.clipboard.writeText(val);
    toast({ title: `${label} kopiert` });
  };

  const setWebIdStatus = async (next: WebIdStatus) => {
    if (!assignmentId) return false;
    setSaving(next);
    const payload: Record<string, unknown> = { webid_status: next };
    if (next === "gestartet") payload.webid_started_at = new Date().toISOString();
    if (next === "bestaetigt") payload.webid_confirmed_at = new Date().toISOString();
    const { error } = await supabase.from("task_assignments").update(payload as never).eq("id", assignmentId);
    setSaving(null);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return false;
    }
    setStatus(next);
    if (next === "bestaetigt") toast({ title: "Danke! Abschluss wurde gemeldet." });
    return true;
  };

  // Übergabe an WebID im selben Tab: kein iFrame, kein Popup, kein Umschalten.
  // Der Mitarbeiter kommt über den Zurück-/Rückkehr-Weg direkt wieder auf dieser
  // Station an und sieht dann die Abschluss-Ansicht.
  const goToWebId = async () => {
    if (status === "offen") await setWebIdStatus("gestartet");
    window.location.assign(targetUrl);
  };

  const uploadProof = async (file: File) => {
    if (!user || !assignmentId) return;
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "Datei zu groß", description: "Maximal 20 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    const path = `${user.id}/webid/${assignmentId}-${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage
      .from("employee-documents")
      .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream" });
    if (upErr) {
      setUploading(false);
      toast({ title: "Upload fehlgeschlagen", description: upErr.message, variant: "destructive" });
      return;
    }
    const { error: docErr } = await supabase.from("documents").insert({
      user_id: user.id,
      file_name: file.name,
      file_url: path,
      file_size: file.size,
      mime_type: file.type || null,
      category: "auftrag",
      uploaded_by: user.id,
      notes: `WebID-Nachweis zum Auftrag ${assignmentId}`,
    } as never);
    setUploading(false);
    if (docErr) {
      toast({ title: "Fehler", description: docErr.message, variant: "destructive" });
      return;
    }
    toast({ title: "Nachweis hochgeladen" });
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!row) {
    return (
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">Auftrag nicht gefunden.</p>
        <Button variant="outline" onClick={() => navigate("/tasks")}>Zurück zu den Aufträgen</Button>
      </div>
    );
  }

  const targetUrl = buildWebIdStartUrl(row.webid_start_url, row.individual_case_number);
  const badge = WEBID_STATUS_LABEL[status] ?? WEBID_STATUS_LABEL.offen;
  const done = status === "bestaetigt" || status === "geprueft";
  const allChecked = checked.every(Boolean);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/tasks/${assignmentId}`)}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Zurück zum Auftrag
        </Button>
        <Badge className={badge.className}>{badge.label}</Badge>
      </div>

      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <ShieldCheck className="h-5 w-5 text-primary" /> WebID-Identifikation
        </h1>
        <p className="text-sm text-muted-foreground">
          {row.webid_client_name ? `Im Auftrag von ${row.webid_client_name}` : row.task_templates?.title ?? "Identifikation"}
          {" · "}Die Identifizierung selbst führt WebID durch — das Portal begleitet dich nur dabei.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-[520px]">
          {status === "offen" ? (
            <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
              <ShieldCheck className="h-10 w-10 text-primary" />
              <div className="max-w-md space-y-2">
                <p className="font-medium">Bereit für die Identifikation?</p>
                <p className="text-sm text-muted-foreground">
                  Gehe zuerst die Checkliste rechts durch. Mit dem Klick auf „Weiter zu WebID“
                  wechselt dieses Fenster direkt zur offiziellen WebID-Oberfläche — dort läuft die
                  Identifikation mit den Original-Hinweisen von WebID.
                </p>
                <p className="text-sm text-muted-foreground">
                  Danach kommst du über „Zurück zum Portal“ wieder hierher und meldest den Abschluss.
                </p>
              </div>
              <Button size="lg" disabled={!allChecked || saving !== null} onClick={() => void goToWebId()}>
                {saving === "gestartet"
                  ? <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  : <ArrowRight className="mr-2 h-5 w-5" />}
                Weiter zu WebID
              </Button>
              {!allChecked && (
                <p className="text-xs text-muted-foreground">Bitte zuerst alle Punkte der Checkliste bestätigen.</p>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-muted/20 p-8 text-center">
              {done
                ? <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                : <ShieldCheck className="h-10 w-10 text-primary" />}
              <div className="max-w-md space-y-2">
                <p className="font-medium">
                  {done ? "Identifikation abgeschlossen" : "Identifikation läuft bei WebID"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {done
                    ? "Danke — dein Abschluss ist gemeldet. Wir prüfen den Auftrag und melden uns, falls etwas fehlt."
                    : "Du hast die Identifikation gestartet. Sobald WebID dir die Bestätigung angezeigt hat, melde den Abschluss rechts zurück. Falls du zwischendurch abgebrochen hast, kannst du jederzeit erneut zu WebID wechseln."}
                </p>
              </div>
              {!done && (
                <Button variant="outline" onClick={() => void goToWebId()}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Erneut zu WebID
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => navigate(`/tasks/${assignmentId}`)}>
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Zurück zum Auftrag
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {row.individual_case_number && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Vorgangsnummer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-center">
                <p className="break-all font-mono text-xl font-bold tracking-widest">{row.individual_case_number}</p>
                <Button size="sm" variant="outline" onClick={() => copy(row.individual_case_number!, "Vorgangsnummer")}>
                  <Copy className="mr-1 h-3.5 w-3.5" /> Kopieren
                </Button>
                <p className="text-xs text-muted-foreground">Gib diese Nummer bei WebID ein, wenn danach gefragt wird.</p>
              </CardContent>
            </Card>
          )}

          {(row.individual_email || row.individual_password) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Zugangsdaten</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {row.individual_email && <CredRow label="E-Mail" value={row.individual_email} onCopy={copy} />}
                {row.individual_password && <CredRow label="Passwort" value={row.individual_password} onCopy={copy} />}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Checkliste</CardTitle></CardHeader>
            <CardContent className="space-y-2.5">
              {CHECKLIST.map((item, i) => (
                <label key={item} className="flex cursor-pointer items-start gap-2 text-sm">
                  <Checkbox
                    checked={checked[i]}
                    onCheckedChange={(v) => setChecked((c) => c.map((x, idx) => (idx === i ? v === true : x)))}
                    className="mt-0.5"
                  />
                  <span className="text-muted-foreground">{item}</span>
                </label>
              ))}
            </CardContent>
          </Card>

          {row.individual_hint && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Hinweis</CardTitle></CardHeader>
              <CardContent><p className="whitespace-pre-wrap text-sm text-muted-foreground">{row.individual_hint}</p></CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Smartphone className="h-4 w-4" /> Lieber am Handy?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Am Smartphone läuft die Kamera-Identifikation oft zuverlässiger.
              </p>
              {WEBID_APP_LINKS.map((l) => (
                <Button key={l.href} asChild variant="outline" size="sm" className="w-full justify-start">
                  <a href={l.href} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> {l.label}
                  </a>
                </Button>
              ))}
            </CardContent>
          </Card>

          <Card className="border-primary/30">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Abschluss melden</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Sobald WebID die Identifikation bestätigt hat, melde den Abschluss hier zurück.
              </p>
              <Button className="w-full" disabled={saving !== null || done} onClick={() => setWebIdStatus("bestaetigt")}>
                {saving === "bestaetigt"
                  ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                {done ? "Abschluss gemeldet" : "Identifikation abgeschlossen"}
              </Button>
              <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-2.5 text-xs text-muted-foreground hover:bg-muted/40">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Nachweis hochladen (optional)
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadProof(f); e.target.value = ""; }}
                />
              </label>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CredRow({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string, l: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-2.5">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-sm">{value}</p>
      </div>
      <Button size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0" onClick={() => onCopy(value, label)}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
