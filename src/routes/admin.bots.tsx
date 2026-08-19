import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listBotProfiles, saveBotProfile, deleteBotProfile,
  listBotRuns, enqueueBotRun, claimBotRun, setBotRunStatus,
  type BotStep, type BotProfileRow,
} from "@/lib/bots.functions";
import { useAdminData } from "@/contexts/AdminDataContext";
import { getAllEmployees } from "@/lib/employee-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { Bot, Plus, Trash2, Play, AlertTriangle, UserCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BotProxyPanel } from "@/components/admin/BotProxyPanel";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/admin/bots")({
  component: AdminBotsPage,
  head: () => ({
    meta: [
      { title: "Bot-Automatisierung – Admin" },
      { name: "description", content: "Registrierungs-Bots pro Anbieter verwalten und Läufe überwachen." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const EMPTY_PROFILE = {
  id: undefined as string | undefined,
  name: "",
  provider_key: "",
  start_url: "",
  description: "",
  handoff_note: "",
  steps: "[]",
  is_active: true,
};

function statusBadge(status: string) {
  switch (status) {
    case "done": return "bg-status-success text-status-success-foreground";
    case "failed": return "bg-destructive text-destructive-foreground";
    case "waiting_admin": return "bg-status-warning text-status-warning-foreground";
    case "running": return "bg-status-info text-status-info-foreground";
    case "cancelled": return "bg-muted text-muted-foreground";
    default: return "bg-secondary text-secondary-foreground";
  }
}

const STATUS_LABEL: Record<string, string> = {
  queued: "In Warteschlange",
  running: "Läuft",
  waiting_admin: "Wartet auf Admin",
  done: "Abgeschlossen",
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
};

function AdminBotsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { profiles: userProfiles, adminUserIds } = useAdminData();
  const employees = getAllEmployees(userProfiles, adminUserIds);
  const nameByUser = useMemo(
    () => new Map(userProfiles.map((p) => [p.user_id, p.full_name])),
    [userProfiles],
  );

  const loadProfiles = useServerFn(listBotProfiles);
  const loadRuns = useServerFn(listBotRuns);
  const save = useServerFn(saveBotProfile);
  const remove = useServerFn(deleteBotProfile);
  const enqueue = useServerFn(enqueueBotRun);
  const claim = useServerFn(claimBotRun);
  const setStatus = useServerFn(setBotRunStatus);

  const profilesQ = useQuery({ queryKey: ["bot-profiles"], queryFn: () => loadProfiles() });
  const runsQ = useQuery({
    queryKey: ["bot-runs"],
    queryFn: () => loadRuns(),
    refetchInterval: 8000,
  });

  const [editor, setEditor] = useState<typeof EMPTY_PROFILE | null>(null);
  const [startFor, setStartFor] = useState<BotProfileRow | null>(null);
  const [startUser, setStartUser] = useState("");
  const [startVorgang, setStartVorgang] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bot-profiles"] });
    qc.invalidateQueries({ queryKey: ["bot-runs"] });
  };

  const saveM = useMutation({
    mutationFn: async (form: typeof EMPTY_PROFILE) => {
      let steps: BotStep[];
      try {
        steps = JSON.parse(form.steps);
        if (!Array.isArray(steps)) throw new Error("Schritte müssen eine Liste sein");
      } catch (e: any) {
        throw new Error(`Schritte-JSON ungültig: ${e.message}`);
      }
      return save({ data: { ...form, steps } });
    },
    onSuccess: () => { toast({ title: "Bot-Profil gespeichert" }); setEditor(null); invalidate(); },
    onError: (e: any) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => { toast({ title: "Profil gelöscht" }); invalidate(); },
    onError: (e: any) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const startM = useMutation({
    mutationFn: () => enqueue({
      data: {
        profile_id: startFor!.id,
        user_id: startUser || null,
        vorgangsnummer: startVorgang,
      },
    }),
    onSuccess: () => {
      toast({ title: "Bot-Lauf eingereiht", description: "Der Runner übernimmt ihn innerhalb weniger Sekunden." });
      setStartFor(null); setStartUser(""); setStartVorgang("");
      invalidate();
    },
    onError: (e: any) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const statusM = useMutation({
    mutationFn: (v: { id: string; status: "done" | "failed" | "cancelled" }) =>
      setStatus({ data: { id: v.id, status: v.status } }),
    onSuccess: () => { toast({ title: "Status aktualisiert" }); invalidate(); },
    onError: (e: any) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const claimM = useMutation({
    mutationFn: (id: string) => claim({ data: { id } }),
    onSuccess: () => { toast({ title: "Übernommen" }); invalidate(); },
    onError: (e: any) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const profileById = new Map((profilesQ.data?.rows ?? []).map((p) => [p.id, p]));
  const waiting = (runsQ.data?.rows ?? []).filter((r) => r.status === "waiting_admin");

  return (
    <div className="p-6 lg:p-8 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-heading font-bold text-foreground">Bot-Automatisierung</h1>
            <Badge variant="outline" className="text-[10px] bg-status-warning/10 text-status-warning border-status-warning/30">
              Beta
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Bots füllen Registrierungsstrecken automatisch aus. Bei Legitimation (VideoIdent, TAN)
            übergeben sie an einen Admin.
          </p>
        </div>
        <Button size="sm" className="h-9 text-xs gap-1.5" onClick={() => setEditor({ ...EMPTY_PROFILE })}>
          <Plus className="h-3.5 w-3.5" /> Neues Bot-Profil
        </Button>
      </div>

      <div className="rounded-xl border border-status-warning/30 bg-status-warning/5 p-4 flex gap-3">
        <AlertTriangle className="h-4 w-4 text-status-warning shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Grenzen der Automatisierung</p>
          <p>
            VideoIdent, PostIdent, photoTAN und Captchas lassen sich nicht automatisieren — gesetzlich
            (GwG §12) und technisch. Der Bot arbeitet bis zu diesem Punkt und stellt den Lauf dann auf
            „Wartet auf Admin". Prüfe vor produktivem Einsatz die AGB des jeweiligen Anbieters.
          </p>
        </div>
      </div>

      {waiting.length > 0 && (
        <div className="rounded-xl border border-status-warning/40 bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <UserCheck className="h-4 w-4 text-status-warning" />
            <h2 className="text-sm font-semibold">{waiting.length} Lauf/Läufe warten auf dich</h2>
          </div>
          <div className="space-y-2">
            {waiting.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 text-xs border-t border-border pt-2">
                <div>
                  <span className="font-medium">{profileById.get(r.profile_id)?.name ?? "—"}</span>
                  {r.user_id && <span className="text-muted-foreground"> · {nameByUser.get(r.user_id)}</span>}
                  <p className="text-muted-foreground mt-0.5">{r.handoff_reason || "Manueller Schritt erforderlich"}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => claimM.mutate(r.id)}>
                    Übernehmen
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={() => statusM.mutate({ id: r.id, status: "done" })}>
                    Erledigt
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Tabs defaultValue="profiles">
        <TabsList>
          <TabsTrigger value="profiles" className="text-xs">Bot-Profile</TabsTrigger>
          <TabsTrigger value="runs" className="text-xs">Läufe</TabsTrigger>
          <TabsTrigger value="proxies" className="text-xs">Proxys</TabsTrigger>
        </TabsList>

        <TabsContent value="profiles" className="mt-4">
          {(profilesQ.data?.rows ?? []).length === 0 ? (
            <EmptyState icon={Bot} title="Noch keine Bot-Profile" description="Lege ein Profil pro Anbieter an." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {(profilesQ.data?.rows ?? []).map((p) => (
                <div key={p.id} className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold">{p.name}</h3>
                      <p className="text-[11px] font-mono text-muted-foreground">{p.provider_key}</p>
                    </div>
                    <Badge variant="secondary" className={`text-[10px] ${p.is_active ? "bg-status-success text-status-success-foreground" : "bg-muted text-muted-foreground"}`}>
                      {p.is_active ? "aktiv" : "inaktiv"}
                    </Badge>
                  </div>
                  {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                  <p className="text-[11px] text-muted-foreground">{p.steps?.length ?? 0} Schritte</p>
                  <div className="flex gap-1.5 pt-1">
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setStartFor(p)}>
                      <Play className="h-3 w-3" /> Starten
                    </Button>
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => setEditor({
                        id: p.id, name: p.name, provider_key: p.provider_key,
                        start_url: p.start_url, description: p.description ?? "",
                        handoff_note: p.handoff_note ?? "", is_active: p.is_active,
                        steps: JSON.stringify(p.steps ?? [], null, 2),
                      })}
                    >
                      Bearbeiten
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteM.mutate(p.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          {(runsQ.data?.rows ?? []).length === 0 ? (
            <EmptyState icon={Bot} title="Noch keine Läufe" description="Starte einen Bot über ein Profil." />
          ) : (
            <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Profil", "Mitarbeiter", "Vorgang", "Fortschritt", "Status", "Gestartet", "Aktionen"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(runsQ.data?.rows ?? []).map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3">{profileById.get(r.profile_id)?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.user_id ? nameByUser.get(r.user_id) ?? "–" : "–"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{r.vorgangsnummer || "–"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {r.current_step}/{r.total_steps}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className={`text-[10px] ${statusBadge(r.status)}`}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                        {r.last_error && (
                          <p className="text-[10px] text-destructive mt-1 max-w-xs truncate">{r.last_error}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {r.started_at ? new Date(r.started_at).toLocaleString("de-DE") : "–"}
                      </td>
                      <td className="px-4 py-3">
                        {!["done", "cancelled"].includes(r.status) && (
                          <Button
                            size="sm" variant="ghost" className="h-7 text-xs"
                            onClick={() => statusM.mutate({ id: r.id, status: "cancelled" })}
                          >
                            Abbrechen
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="proxies" className="mt-4">
          <BotProxyPanel />
        </TabsContent>
      </Tabs>

      {/* Profil-Editor */}
      <Dialog open={!!editor} onOpenChange={(v) => !v && setEditor(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editor?.id ? "Bot-Profil bearbeiten" : "Neues Bot-Profil"}</DialogTitle>
          </DialogHeader>
          {editor && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Name *</Label>
                  <Input value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} placeholder="Deutsche Bank – Girokonto" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Schlüssel *</Label>
                  <Input value={editor.provider_key} onChange={(e) => setEditor({ ...editor, provider_key: e.target.value })} placeholder="deutsche_bank" className="font-mono text-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Start-URL *</Label>
                <Input value={editor.start_url} onChange={(e) => setEditor({ ...editor, start_url: e.target.value })} placeholder="https://…" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Beschreibung</Label>
                <Textarea rows={2} value={editor.description} onChange={(e) => setEditor({ ...editor, description: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Hinweis zur Admin-Übergabe</Label>
                <Textarea rows={2} value={editor.handoff_note} onChange={(e) => setEditor({ ...editor, handoff_note: e.target.value })} placeholder="Was muss der Admin manuell erledigen?" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Schritte (JSON)</Label>
                <Textarea
                  rows={12}
                  className="font-mono text-xs"
                  value={editor.steps}
                  onChange={(e) => setEditor({ ...editor, steps: e.target.value })}
                />
                <p className="text-[10px] text-muted-foreground">
                  Aktionen: goto, fill, click, select, wait, screenshot, handoff. Platzhalter wie{" "}
                  <code>{"{{first_name}}"}</code>, <code>{"{{email}}"}</code>, <code>{"{{password}}"}</code>{" "}
                  werden pro Lauf ersetzt. <code>"optional": true</code> überspringt fehlende Elemente.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editor.is_active} onCheckedChange={(v) => setEditor({ ...editor, is_active: v })} />
                <Label className="text-xs">Aktiv</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditor(null)}>Abbrechen</Button>
            <Button onClick={() => editor && saveM.mutate(editor)} disabled={saveM.isPending}>
              {saveM.isPending ? "Speichern…" : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lauf starten */}
      <Dialog open={!!startFor} onOpenChange={(v) => !v && setStartFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bot starten – {startFor?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Mitarbeiter (Datenquelle)</Label>
              <Select value={startUser} onValueChange={setStartUser}>
                <SelectTrigger><SelectValue placeholder="Mitarbeiter wählen…" /></SelectTrigger>
                <SelectContent>
                  {employees.map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Name, Adresse und Geburtsdatum werden aus dem Profil übernommen.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Vorgangsnummer</Label>
              <Input value={startVorgang} onChange={(e) => setStartVorgang(e.target.value)} className="font-mono text-sm" />
            </div>
            {startFor?.handoff_note && (
              <p className="text-[11px] text-muted-foreground rounded-lg bg-muted/40 p-2">
                {startFor.handoff_note}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStartFor(null)}>Abbrechen</Button>
            <Button onClick={() => startM.mutate()} disabled={startM.isPending}>
              {startM.isPending ? "Wird eingereiht…" : "Bot starten"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}