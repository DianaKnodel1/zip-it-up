import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/contracts")({
  component: AdminContractsPage,
});

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAllTenants } from "@/hooks/use-tenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Plus, Pencil, Copy, FileText, Info, Trash2, ChevronDown, Search, AlertTriangle, Building2,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { getStandardContractTemplate, standardContractTitle } from "@/lib/contract-templates";

const EMPLOYMENT_LABELS: Record<string, string> = {
  minijob: "Minijob", teilzeit: "Teilzeit", vollzeit: "Vollzeit",
};
const EMPLOYMENT_ORDER = ["minijob", "teilzeit", "vollzeit"];

const PLACEHOLDER_GROUPS: { label: string; items: { ph: string; desc: string }[] }[] = [
  {
    label: "Arbeitnehmer",
    items: [
      { ph: "{{first_name}}", desc: "Vorname" },
      { ph: "{{last_name}}", desc: "Nachname" },
      { ph: "{{address}}", desc: "Adresse (Straße, PLZ Ort)" },
      { ph: "{{city}}", desc: "Wohnort" },
    ],
  },
  {
    label: "Firma",
    items: [
      { ph: "{{company_name}}", desc: "Firmenname" },
      { ph: "{{company_ceo_name}}", desc: "Geschäftsführer" },
      { ph: "{{company_address}}", desc: "Firmenadresse" },
      { ph: "{{company_city}}", desc: "Firmen-Stadt" },
    ],
  },
  {
    label: "Vertrag",
    items: [
      { ph: "{{employment_type}}", desc: "Minijob / Teilzeit / Vollzeit" },
      { ph: "{{weekly_hours}}", desc: "Wochenstunden" },
      { ph: "{{monthly_salary}}", desc: "Monatsgehalt" },
      { ph: "{{start_date}}", desc: "Vertragsbeginn" },
      { ph: "{{date}}", desc: "Heutiges Datum" },
    ],
  },
];
const PLACEHOLDERS = PLACEHOLDER_GROUPS.flatMap((g) => g.items.map((i) => i.ph));

interface Template {
  id: string;
  tenant_id: string;
  employment_type: string;
  title: string;
  body_html: string;
  content: string;
  version: number;
  is_active: boolean;
  created_at: string;
}

function AdminContractsPage() {
  const { tenants } = useAllTenants();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTenant, setFilterTenant] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [openTenants, setOpenTenants] = useState<Record<string, boolean>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);

  // Form state
  const [formTenant, setFormTenant] = useState("");
  const [formType, setFormType] = useState("minijob");
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formPreset, setFormPreset] = useState("standard");
  const [showPlaceholders, setShowPlaceholders] = useState(false);
  const [rolloutOpen, setRolloutOpen] = useState(false);
  const [rolloutReplace, setRolloutReplace] = useState(false);
  const [rolloutBusy, setRolloutBusy] = useState(false);

  const loadTemplates = async () => {
    const { data } = await supabase
      .from("contract_templates")
      .select("*")
      .order("created_at", { ascending: false });
    setTemplates((data as Template[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { loadTemplates(); }, []);

  const resetForm = () => {
    setEditing(null);
    setFormTenant(tenants[0]?.id ?? "");
    setFormType("minijob");
    setFormTitle("");
    setFormContent(getStandardContractTemplate("minijob"));
    setFormPreset("standard");
    setFormActive(true);
  };

  const openCreate = () => { resetForm(); setDialogOpen(true); };

  /** Beschäftigungsart im Dialog wechseln – Standardtext ggf. nachziehen. */
  const changeFormType = (v: string) => {
    setFormType(v);
    if (!editing && formPreset === "standard") setFormContent(getStandardContractTemplate(v));
  };

  const openEdit = (t: Template) => {
    setEditing(t);
    setFormTenant(t.tenant_id);
    setFormType(t.employment_type);
    setFormTitle(t.title);
    setFormContent(t.content || t.body_html);
    setFormPreset("standard");
    setFormActive(t.is_active);
    setDialogOpen(true);
  };

  const handleDuplicate = async (t: Template) => {
    await supabase.from("contract_templates").insert({
      tenant_id: t.tenant_id,
      employment_type: t.employment_type as any,
      title: `${t.title} (Kopie)`,
      body_html: t.body_html,
      content: t.content,
      version: 1,
      is_active: false,
    });
    toast({ title: "Dupliziert" });
    loadTemplates();
  };

  const handleSave = async () => {
    if (!formTenant || !formTitle.trim() || !formContent.trim()) {
      toast({ title: "Fehler", description: "Bitte alle Felder ausfüllen.", variant: "destructive" });
      return;
    }
    if (editing) {
      await supabase.from("contract_templates").update({
        title: formTitle.trim(),
        content: formContent,
        body_html: formContent,
        employment_type: formType as any,
        is_active: formActive,
        version: editing.version + 1,
      }).eq("id", editing.id);
      toast({ title: "Template aktualisiert" });
    } else {
      await supabase.from("contract_templates").insert({
        tenant_id: formTenant,
        employment_type: formType as any,
        title: formTitle.trim(),
        content: formContent,
        body_html: formContent,
        is_active: formActive,
      });
      toast({ title: "Template erstellt" });
    }
    setDialogOpen(false);
    loadTemplates();
  };

  const toggleActive = async (t: Template) => {
    await supabase.from("contract_templates").update({ is_active: !t.is_active }).eq("id", t.id);
    loadTemplates();
  };

  const handleDelete = async (t: Template) => {
    const { error } = await supabase.from("contract_templates").delete().eq("id", t.id);
    if (error) {
      toast({ title: "Fehler beim Löschen", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Template gelöscht" });
    loadTemplates();
  };

  const getTenantName = (id: string) => tenants.find((t) => t.id === id)?.name ?? "Ohne Firma";

  /**
   * Legt für jede Firma die fehlenden Standardvorlagen (Minijob/Teilzeit/
   * Vollzeit) an. Bestehende Vorlagen werden nur ersetzt, wenn der Admin das
   * ausdrücklich anhakt – dann als neue Version, die alte wird deaktiviert.
   */
  const rolloutPlan = tenants.map((tenant) => {
    const own = templates.filter((t) => t.tenant_id === tenant.id);
    const existing = EMPLOYMENT_ORDER.filter((type) => own.some((t) => t.employment_type === type));
    return {
      tenantId: tenant.id,
      name: tenant.name,
      missing: EMPLOYMENT_ORDER.filter((type) => !existing.includes(type)),
      existing,
    };
  });
  const rolloutCreateCount = rolloutPlan.reduce((n, p) => n + p.missing.length, 0);
  const rolloutReplaceCount = rolloutPlan.reduce((n, p) => n + p.existing.length, 0);

  const runRollout = async () => {
    setRolloutBusy(true);
    let created = 0;
    let replaced = 0;
    try {
      for (const plan of rolloutPlan) {
        const types = rolloutReplace ? EMPLOYMENT_ORDER : plan.missing;
        for (const type of types) {
          const content = getStandardContractTemplate(type);
          const old = templates.filter((t) => t.tenant_id === plan.tenantId && t.employment_type === type);
          const nextVersion = Math.max(0, ...old.map((t) => t.version)) + 1;
          const { error } = await supabase.from("contract_templates").insert({
            tenant_id: plan.tenantId,
            employment_type: type as any,
            title: standardContractTitle(type),
            content,
            body_html: content,
            version: nextVersion,
            is_active: true,
          });
          if (error) throw new Error(error.message);
          if (old.length > 0) {
            replaced++;
            await supabase
              .from("contract_templates")
              .update({ is_active: false })
              .in("id", old.map((t) => t.id));
          } else {
            created++;
          }
        }
      }
      toast({
        title: "Standardvorlage ausgerollt",
        description: `${created} neu angelegt${replaced ? `, ${replaced} ersetzt` : ""}.`,
      });
      setRolloutOpen(false);
      setRolloutReplace(false);
      loadTemplates();
    } catch (e: any) {
      toast({ title: "Fehler beim Ausrollen", description: e.message, variant: "destructive" });
    } finally {
      setRolloutBusy(false);
    }
  };

  /** Fehlende Beschäftigungsarten einer einzelnen Firma ergänzen. */
  const fillMissingForTenant = async (tenantId: string) => {
    const own = templates.filter((t) => t.tenant_id === tenantId);
    const missing = EMPLOYMENT_ORDER.filter((type) => !own.some((t) => t.employment_type === type));
    if (missing.length === 0) {
      toast({ title: "Nichts zu ergänzen", description: "Alle Beschäftigungsarten sind vorhanden." });
      return;
    }
    for (const type of missing) {
      const content = getStandardContractTemplate(type);
      await supabase.from("contract_templates").insert({
        tenant_id: tenantId,
        employment_type: type as any,
        title: standardContractTitle(type),
        content,
        body_html: content,
        is_active: true,
      });
    }
    toast({ title: `${missing.length} Vorlage(n) ergänzt` });
    loadTemplates();
  };

  const q = search.trim().toLowerCase();
  const filtered = templates.filter((t) => {
    if (filterTenant !== "all" && t.tenant_id !== filterTenant) return false;
    if (filterType !== "all" && t.employment_type !== filterType) return false;
    if (q) {
      const hay = `${t.title} ${getTenantName(t.tenant_id)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Nach Firma gruppieren – die Gruppe entsteht automatisch aus der
  // Firmenzuordnung des Templates, es gibt keine separaten Gruppen-Datensätze.
  const groups = Array.from(
    filtered.reduce((map, t) => {
      const list = map.get(t.tenant_id) ?? [];
      list.push(t);
      map.set(t.tenant_id, list);
      return map;
    }, new Map<string, Template[]>()),
  )
    .map(([tenantId, items]) => ({
      tenantId,
      name: getTenantName(tenantId),
      items: [...items].sort(
        (a, b) =>
          EMPLOYMENT_ORDER.indexOf(a.employment_type) - EMPLOYMENT_ORDER.indexOf(b.employment_type) ||
          a.title.localeCompare(b.title),
      ),
      missing: EMPLOYMENT_ORDER.filter(
        (type) => !items.some((i) => i.employment_type === type && i.is_active),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const autoOpen = groups.length === 1 || filterTenant !== "all" || q.length > 0;
  const isOpen = (tenantId: string) => openTenants[tenantId] ?? autoOpen;
  const toggleGroup = (tenantId: string) =>
    setOpenTenants((prev) => ({ ...prev, [tenantId]: !isOpen(tenantId) }));

  return (
    <div className="p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Vertrags-Templates</h1>
          <p className="text-sm text-muted-foreground">Vorlagen für automatische Vertragsgenerierung</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setRolloutOpen(true)} className="gap-2">
            <Building2 className="h-4 w-4" /> Standardvorlage für alle Firmen
          </Button>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" /> Neues Template
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={filterTenant} onValueChange={setFilterTenant}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Alle Tenants" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Tenants</SelectItem>
            {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Alle Typen" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Typen</SelectItem>
            {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Vorlage oder Firma suchen…"
            className="pl-8"
          />
        </div>
      </div>

      {/* Placeholder Info */}
      <Card className="border-dashed">
        <CardContent className="py-3 px-4 flex items-start gap-2">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground space-y-2 flex-1">
            <button
              type="button"
              onClick={() => setShowPlaceholders((v) => !v)}
              className="font-medium text-foreground flex items-center gap-1"
            >
              Verfügbare Platzhalter
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showPlaceholders ? "rotate-180" : ""}`} />
            </button>
            {showPlaceholders && (<>
            <p className="text-[11px]">
              Wichtig: <code className="bg-muted px-1 rounded">{`{{address}}`}</code> und <code className="bg-muted px-1 rounded">{`{{city}}`}</code> beziehen sich auf den <b>Arbeitnehmer</b>.
              Für die Firmenadresse <b>immer</b> <code className="bg-muted px-1 rounded">{`{{company_address}}`}</code> / <code className="bg-muted px-1 rounded">{`{{company_city}}`}</code> verwenden.
            </p>
            {PLACEHOLDER_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="font-medium text-foreground mt-1">{group.label}</p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 mt-0.5">
                  {group.items.map((it) => (
                    <li key={it.ph} className="flex items-baseline gap-2">
                      <code className="bg-muted px-1 py-0.5 rounded text-[10px]">{it.ph}</code>
                      <span className="text-[11px]">{it.desc}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            </>)}
          </div>
        </CardContent>
      </Card>

      {/* Templates List */}
      {loading ? (
        <p className="text-muted-foreground text-sm">Laden…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">Noch keine Templates vorhanden.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
          <Collapsible key={group.tenantId} open={isOpen(group.tenantId)} onOpenChange={() => toggleGroup(group.tenantId)}>
            <Card>
              <CollapsibleTrigger asChild>
                <button type="button" className="w-full text-left px-5 py-4 flex items-center gap-3 hover:bg-muted/40 transition-colors rounded-lg">
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen(group.tenantId) ? "" : "-rotate-90"}`} />
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-semibold text-foreground truncate">{group.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">
                    {group.items.length} {group.items.length === 1 ? "Vorlage" : "Vorlagen"} ·{" "}
                    {group.items.filter((i) => i.is_active).length} aktiv
                  </span>
                  {group.missing.length > 0 && (
                    <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/50 text-amber-600 shrink-0">
                      <AlertTriangle className="h-3 w-3" />
                      {group.missing.map((m) => EMPLOYMENT_LABELS[m]).join(", ")} fehlt
                    </Badge>
                  )}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-3 pb-3 space-y-2">
                  {group.missing.length > 0 && (
                    <p className="text-[11px] text-amber-600 px-2">
                      Ohne aktive Vorlage kann für diese Beschäftigungsart kein Vertrag erzeugt werden:{" "}
                      {group.missing.map((m) => EMPLOYMENT_LABELS[m]).join(", ")}.
                    </p>
                  )}
                  {EMPLOYMENT_ORDER.some((type) => !group.items.some((i) => i.employment_type === type)) && (
                    <div className="px-2">
                      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                        onClick={() => fillMissingForTenant(group.tenantId)}>
                        <Plus className="h-3 w-3" /> Fehlende Arten mit Standardvorlage ergänzen
                      </Button>
                    </div>
                  )}
                  {group.items.map((t) => (
            <div key={t.id} className="rounded-md border border-border/60 bg-muted/20 py-3 px-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[10px]">{EMPLOYMENT_LABELS[t.employment_type] ?? t.employment_type}</Badge>
                    <p className="font-medium text-foreground truncate">{t.title}</p>
                    <Badge variant={t.is_active ? "default" : "secondary"} className="text-[10px]">
                      {t.is_active ? "Aktiv" : "Inaktiv"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">v{t.version}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={t.is_active} onCheckedChange={() => toggleActive(t)} />
                  <Button variant="ghost" size="icon" onClick={() => openEdit(t)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDuplicate(t)}><Copy className="h-4 w-4" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Template „{t.title}" löschen?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Diese Aktion kann nicht rückgängig gemacht werden. Bereits generierte Verträge bleiben erhalten.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(t)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Endgültig löschen
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
            </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Template bearbeiten" : "Neues Template erstellen"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Tenant</label>
                <Select value={formTenant} onValueChange={setFormTenant} disabled={!!editing}>
                  <SelectTrigger><SelectValue placeholder="Tenant wählen" /></SelectTrigger>
                  <SelectContent>
                    {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Beschäftigungsart</label>
                <Select value={formType} onValueChange={changeFormType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Titel</label>
              <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="z.B. Minijob-Vertrag 2026" />
            </div>
            {!editing && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Vorlage als Startpunkt</label>
                <Select
                  value={formPreset}
                  onValueChange={(v) => {
                    setFormPreset(v);
                    setFormContent(v === "kurz" ? SHORT_CONTRACT_TEMPLATE : getStandardContractTemplate(formType));
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standardvertrag (Home-Office / auftragsbezogen)</SelectItem>
                    <SelectItem value="kurz">Kurzfassung (alt)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Der Standardtext passt sich der gewählten Beschäftigungsart an (§ 3 / § 4) und kann anschließend frei angepasst werden.
                </p>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Vertragstext (mit Platzhaltern)</label>
              <Textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                rows={16}
                className="font-mono text-xs"
                placeholder="Vertragstext hier eingeben…"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={formActive} onCheckedChange={setFormActive} />
              <label className="text-sm">Aktiv</label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Abbrechen</Button>
              <Button onClick={handleSave}>{editing ? "Speichern" : "Erstellen"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rollout-Dialog: Standardvorlage für alle Firmen */}
      <Dialog open={rolloutOpen} onOpenChange={setRolloutOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Standardvorlage für alle Firmen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2 text-sm">
            <p className="text-muted-foreground text-xs">
              Legt je Firma die Standardvorlage für Minijob, Teilzeit und Vollzeit an. Firmen- und
              Personendaten werden beim Unterschreiben automatisch eingesetzt.
            </p>
            <div className="rounded-md border border-border/60 divide-y divide-border/60">
              {rolloutPlan.map((p) => (
                <div key={p.tenantId} className="px-3 py-2 flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{p.name}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {p.missing.length > 0
                      ? `${p.missing.map((m) => EMPLOYMENT_LABELS[m]).join(", ")} wird angelegt`
                      : rolloutReplace ? "wird ersetzt" : "vollständig – übersprungen"}
                  </span>
                </div>
              ))}
              {rolloutPlan.length === 0 && (
                <p className="px-3 py-3 text-xs text-muted-foreground">Keine Firmen vorhanden.</p>
              )}
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={rolloutReplace} onCheckedChange={(c) => setRolloutReplace(c === true)} />
              <span className="text-xs leading-relaxed">
                Bestehende Vorlagen durch neue Version ersetzen ({rolloutReplaceCount} betroffen).
                Die alten Versionen bleiben erhalten, werden aber deaktiviert.
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRolloutOpen(false)}>Abbrechen</Button>
              <Button
                onClick={runRollout}
                disabled={rolloutBusy || (rolloutCreateCount === 0 && !rolloutReplace)}
              >
                {rolloutBusy ? "Wird ausgerollt…" : `Ausrollen (${rolloutReplace ? rolloutCreateCount + rolloutReplaceCount : rolloutCreateCount})`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const SHORT_CONTRACT_TEMPLATE = `ARBEITSVERTRAG

Zwischen
{{company_name}}
vertreten durch {{company_ceo_name}}
(nachfolgend „Arbeitgeber")

und

{{first_name}} {{last_name}}
{{address}}, {{city}}
(nachfolgend „Arbeitnehmer")

wird folgender Vertrag geschlossen:

§ 1 – Beginn und Art der Tätigkeit
Das Arbeitsverhältnis als {{employment_type}} beginnt mit der digitalen Unterzeichnung dieses Vertrags.

§ 2 – Tätigkeit
Der Arbeitnehmer wird als Servicemitarbeiter eingesetzt.

§ 3 – Arbeitszeit
Die Arbeitszeit richtet sich nach der vereinbarten Beschäftigungsart ({{employment_type}}).

§ 4 – Vergütung
Die Vergütung erfolgt gemäß den geltenden Vereinbarungen.

§ 5 – Kündigung
Das Arbeitsverhältnis kann von beiden Seiten mit einer Frist von 14 Tagen gekündigt werden.

§ 6 – Vertraulichkeit
Der Arbeitnehmer verpflichtet sich zur Verschwiegenheit über betriebliche Angelegenheiten.

§ 7 – Schlussbestimmungen
Änderungen und Ergänzungen dieses Vertrags bedürfen der Schriftform.

Datum: {{date}}`;
