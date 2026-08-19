// Legt eine echte Auftragszuweisung an (task_assignments) und verknüpft sie
// optional mit einer Terminbuchung (bookings.assignment_id).
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAdminData } from "@/contexts/AdminDataContext";
import { getAssignableEmployees } from "@/lib/employee-utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Vorbelegter Mitarbeiter (aus einem Termin). Wenn gesetzt, ist die Auswahl fix. */
  userId?: string | null;
  /** Vorbelegte Vorlage (aus der Auftrags-Übersicht). Wenn gesetzt, ist die Auswahl fix. */
  templateId?: string | null;
  /** Buchung, die mit der neuen Zuweisung verknüpft wird. */
  bookingId?: string | null;
  /** ISO-Zeitpunkt (lokal, "YYYY-MM-DDTHH:mm") für die Freigabe. */
  defaultReleaseAt?: string | null;
  onCreated?: (assignmentId: string) => void;
}

export function AssignTaskDialog({
  open, onOpenChange, userId, templateId, bookingId, defaultReleaseAt, onCreated,
}: Props) {
  const { templates, profiles, adminUserIds, assignments, loadData } = useAdminData();
  const { toast } = useToast();

  const [selectedUser, setSelectedUser] = useState(userId ?? "");
  const [selectedTemplate, setSelectedTemplate] = useState(templateId ?? "");
  const [releaseAt, setReleaseAt] = useState(defaultReleaseAt ?? "");
  const [hint, setHint] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedUser(userId ?? "");
    setSelectedTemplate(templateId ?? "");
    setReleaseAt(defaultReleaseAt ?? "");
    setHint("");
  }, [open, userId, templateId, defaultReleaseAt]);

  const employees = getAssignableEmployees(profiles, adminUserIds);
  // Dubletten-Schutz: Vorlagen, die dieser Mitarbeiter bereits hat, ausblenden.
  const alreadyAssigned = new Set(
    assignments.filter((a) => a.user_id === selectedUser).map((a) => a.task_template_id),
  );
  const activeTemplates = templates.filter((t) => t.is_active && !alreadyAssigned.has(t.id));
  const employeeName = profiles.find((p) => p.user_id === selectedUser)?.full_name;

  const submit = async () => {
    if (!selectedUser) { toast({ title: "Mitarbeiter wählen", variant: "destructive" }); return; }
    if (!selectedTemplate) { toast({ title: "Auftragsvorlage wählen", variant: "destructive" }); return; }
    if (alreadyAssigned.has(selectedTemplate)) {
      toast({ title: "Bereits zugewiesen", description: "Dieser Mitarbeiter hat diesen Auftrag schon.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("task_assignments")
      .insert({
        user_id: selectedUser,
        task_template_id: selectedTemplate,
        status: "zugewiesen",
        release_at: releaseAt ? new Date(releaseAt).toISOString() : null,
        individual_hint: hint.trim() || null,
        assignment_group: "manuell",
      } as any)
      .select("id")
      .single();

    if (error || !data) {
      toast({ title: "Zuweisung fehlgeschlagen", description: error?.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    if (bookingId) {
      const { error: bErr } = await supabase
        .from("bookings")
        .update({ assignment_id: data.id })
        .eq("id", bookingId);
      if (bErr) {
        toast({ title: "Hinweis", description: "Auftrag angelegt, Termin-Verknüpfung fehlgeschlagen." });
      }
    }

    toast({ title: "Auftrag zugewiesen", description: employeeName ? `An ${employeeName}` : undefined });
    setSaving(false);
    onOpenChange(false);
    onCreated?.(data.id);
    await loadData();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Auftrag zuweisen</DialogTitle>
          <DialogDescription>
            Der Auftrag wird im Portal des Mitarbeiters ab dem Freigabezeitpunkt bearbeitbar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Mitarbeiter</label>
            {userId ? (
              <div className="h-9 rounded-md border border-border bg-muted/40 px-3 flex items-center text-sm">
                {employeeName || "Mitarbeiter"}
              </div>
            ) : (
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="">Bitte wählen…</option>
                {employees.map((p) => (
                  <option key={p.user_id} value={p.user_id}>{p.full_name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Auftragsvorlage</label>
            {templateId ? (
              <div className="h-9 rounded-md border border-border bg-muted/40 px-3 flex items-center text-sm">
                {templates.find((t) => t.id === templateId)?.title || "Vorlage"}
              </div>
            ) : (
              <select
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="">Bitte wählen…</option>
                {activeTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            )}
            {!templateId && activeTemplates.length === 0 && selectedUser && (
              <p className="text-[11px] text-muted-foreground">
                Alle aktiven Aufträge sind diesem Mitarbeiter bereits zugewiesen.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Freigabe ab</label>
            <Input type="datetime-local" value={releaseAt} onChange={(e) => setReleaseAt(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Leer = sofort bearbeitbar.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Individueller Hinweis (optional)</label>
            <Textarea value={hint} onChange={(e) => setHint(e.target.value)} rows={3} placeholder="z. B. Bank, Besonderheiten…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Zuweisen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
