import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, ShieldAlert, ExternalLink, Copy, Save } from "lucide-react";

export const Route = createFileRoute("/admin/webid-sim")({
  component: WebIdSimPage,
  head: () => ({
    meta: [
      { title: "WebID-Simulation – Admin" },
      { name: "description", content: "Registrierte Simulationsdomains für die WebID-Awareness-Umgebung verwalten." },
      { property: "og:title", content: "WebID-Simulation – Admin" },
      { property: "og:description", content: "Registrierte Simulationsdomains für die WebID-Awareness-Umgebung verwalten." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

interface SimDomain {
  id: string;
  domain: string;
  display_name: string;
  target_origin: string;
  logo_url: string | null;
  topbar_text: string;
  is_active: boolean;
  allow_submit: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const EMPTY_FORM = {
  domain: "",
  display_name: "",
  target_origin: "https://webid-gateway.de",
  logo_url: "",
  topbar_text: "SIMULATIONSUMGEBUNG – Keine echte Identifikation. Zu Schulungszwecken.",
  allow_submit: false,
  notes: "",
};

function WebIdSimPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<SimDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [convertInput, setConvertInput] = useState("");
  const [convertDomainId, setConvertDomainId] = useState<string>("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("webid_sim_domains" as never)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Fehler", description: error.message, variant: "destructive" });
    setRows(((data as unknown) as SimDomain[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!form.domain.trim() || !form.display_name.trim()) {
      toast({ title: "Bitte Domain und Anzeigename ausfüllen", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      domain: form.domain.trim().toLowerCase(),
      display_name: form.display_name.trim(),
      target_origin: form.target_origin.trim() || "https://webid-gateway.de",
      logo_url: form.logo_url.trim() || null,
      topbar_text: form.topbar_text.trim(),
      allow_submit: form.allow_submit,
      notes: form.notes.trim() || null,
    };
    const { error } = await supabase.from("webid_sim_domains" as never).insert(payload as never);
    setSaving(false);
    if (error) return toast({ title: "Fehler", description: error.message, variant: "destructive" });
    toast({ title: "Simulationsdomain angelegt" });
    setForm(EMPTY_FORM);
    void load();
  };

  const update = async (id: string, patch: Partial<SimDomain>) => {
    const { error } = await supabase.from("webid_sim_domains" as never).update(patch as never).eq("id", id);
    if (error) toast({ title: "Fehler", description: error.message, variant: "destructive" });
    else void load();
  };

  const remove = async (id: string, domain: string) => {
    if (!confirm(`Simulationsdomain ${domain} wirklich löschen?`)) return;
    const { error } = await supabase.from("webid_sim_domains" as never).delete().eq("id", id);
    if (error) toast({ title: "Fehler", description: error.message, variant: "destructive" });
    else void load();
  };

  const activeDomain = useMemo(() => rows.find((r) => r.id === convertDomainId) ?? rows[0] ?? null, [rows, convertDomainId]);
  const convertedLink = useMemo(() => {
    if (!activeDomain || !convertInput.trim()) return "";
    try {
      const src = new URL(convertInput.trim());
      const target = new URL(activeDomain.target_origin);
      // Nur konvertieren, wenn die Origin passt — sonst warnen.
      if (src.host.toLowerCase() !== target.host.toLowerCase()) {
        return `⚠ Origin passt nicht: Link ist von ${src.host}, Simulation zeigt aber auf ${target.host}.`;
      }
      const out = new URL(src.pathname + src.search + src.hash, `https://${activeDomain.domain}`);
      return out.toString();
    } catch {
      return "⚠ Ungültige URL";
    }
  }, [convertInput, activeDomain]);

  return (
    <div className="space-y-6 p-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-primary" /> WebID-Simulationsumgebung
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Registrierte Domains, unter denen die WebID-Oberfläche für Awareness- und Schulungszwecke
          transparent gespiegelt wird. Es findet keine echte Identifikation statt; Formular-Submits
          werden per Default blockiert. Die eingeblendete Topbar, das Simulations-Popup und der
          Titel-Präfix sind fest im Proxy verdrahtet und lassen sich nicht deaktivieren.
        </p>
      </div>

      <Card className="border-yellow-500/30 bg-yellow-500/5">
        <CardContent className="pt-4 text-sm">
          <p className="font-medium">Rechtlicher Hinweis</p>
          <p className="text-muted-foreground mt-1">
            Der Betrieb setzt eine schriftliche Freigabe des Markeninhabers voraus. Diese Umgebung
            darf nicht für produktive Identifikationsverfahren oder externe Kunden ohne Einwilligung
            genutzt werden.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Neue Simulationsdomain</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Domain (ohne https)</Label>
            <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="webid.uwk-consulting.de" />
          </div>
          <div>
            <Label>Anzeigename</Label>
            <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="UWK Consulting – Schulung" />
          </div>
          <div>
            <Label>Ziel-Origin</Label>
            <Input value={form.target_origin} onChange={(e) => setForm({ ...form, target_origin: e.target.value })} placeholder="https://webid-gateway.de" />
          </div>
          <div>
            <Label>Logo-URL (unten rechts, optional)</Label>
            <Input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="https://.../logo.svg" />
          </div>
          <div className="md:col-span-2">
            <Label>Topbar-Text</Label>
            <Input value={form.topbar_text} onChange={(e) => setForm({ ...form, topbar_text: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Label>Interne Notizen</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <Switch checked={form.allow_submit} onCheckedChange={(v) => setForm({ ...form, allow_submit: v })} />
            <span className="text-sm">POST/Submit an Original weiterreichen (nur mit gutem Grund aktivieren)</span>
          </div>
          <div className="md:col-span-2">
            <Button onClick={create} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Domain anlegen
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Registrierte Domains</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lade…</div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Simulationsdomain angelegt.</p>
          ) : rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-sm font-semibold">{r.domain}</p>
                  <p className="text-xs text-muted-foreground">{r.display_name} · Ziel: {r.target_origin}</p>
                </div>
                <div className="flex items-center gap-2">
                  {r.is_active ? <Badge variant="secondary">Aktiv</Badge> : <Badge variant="outline">Inaktiv</Badge>}
                  {r.allow_submit && <Badge className="bg-yellow-500/15 text-yellow-700">Submit erlaubt</Badge>}
                  <Button size="icon" variant="ghost" asChild>
                    <a href={`https://${r.domain}`} target="_blank" rel="noopener noreferrer" title="Öffnen"><ExternalLink className="h-4 w-4" /></a>
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(r.id, r.domain)} title="Löschen"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-xs">
                <label className="flex items-center gap-2">
                  <Switch checked={r.is_active} onCheckedChange={(v) => update(r.id, { is_active: v })} />
                  <span>Aktiv</span>
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={r.allow_submit} onCheckedChange={(v) => update(r.id, { allow_submit: v })} />
                  <span>Submit an Original</span>
                </label>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Original-Link → Simulations-Link umschreiben</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Fügt nur die Domain aus und lässt Pfad, Query und Fragment unverändert.
          </p>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
            <div>
              <Label>Original-URL</Label>
              <Input value={convertInput} onChange={(e) => setConvertInput(e.target.value)} placeholder="https://webid-gateway.de/service/status/cn/000631/aid/620631658" />
            </div>
            <div>
              <Label>Simulationsdomain</Label>
              <select
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-2 text-sm"
                value={activeDomain?.id ?? ""}
                onChange={(e) => setConvertDomainId(e.target.value)}
              >
                {rows.filter((r) => r.is_active).map((r) => (
                  <option key={r.id} value={r.id}>{r.domain}</option>
                ))}
              </select>
            </div>
          </div>
          {convertedLink && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
              <code className="flex-1 truncate text-xs">{convertedLink}</code>
              {convertedLink.startsWith("http") && (
                <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(convertedLink); toast({ title: "Kopiert" }); }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Der Save-Button-Import wird von einigen UI-Kits als "used" verlangt; hier bewusst behalten,
// falls das Formular später um explizite Save-Buttons erweitert wird.
void Save;