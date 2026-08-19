import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAdminData } from "@/contexts/AdminDataContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarDays, Briefcase, ExternalLink, ClipboardCheck, Wand2, Loader2 } from "lucide-react";
import { TableSkeleton, PageHeaderSkeleton } from "@/components/SkeletonLoaders";
import { useNavigate } from "@/lib/router-compat";
import { AssignTaskDialog } from "@/components/admin/AssignTaskDialog";
import { cn } from "@/lib/utils";
import { planAutoAssignments, runAutoAssignments } from "@/lib/auto-assign";
import { useToast } from "@/hooks/use-toast";

export const Route = createFileRoute("/admin/appointments")({
  component: AdminAppointmentsPage,
});

interface Slot {
  id: string;
  userId: string | null;
  assignmentId: string | null;
  status: string;
  dateStr: string;
  timeStr: string;
  ts: number;
  name: string;
  phone: string | null;
  profileId: string | null;
}

function dayLabel(dateStr: string) {
  const today = new Date();
  const todayStr = today.toLocaleDateString("en-CA");
  const tomorrow = new Date(today.getTime() + 86400000).toLocaleDateString("en-CA");
  if (dateStr === todayStr) return "Heute";
  if (dateStr === tomorrow) return "Morgen";
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function AdminAppointmentsPage() {
  const { allBookings, profiles, assignments, templates, loading, loadData } = useAdminData();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [hidePast, setHidePast] = useState(true);
  const [assignFor, setAssignFor] = useState<Slot | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);

  // Filter-Zustand bleibt erhalten (verpasste Termine sollen sichtbar bleiben).
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("admin-appointments-hide-past") : null;
    if (saved !== null) setHidePast(saved === "1");
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("admin-appointments-hide-past", hidePast ? "1" : "0");
  }, [hidePast]);

  const slots = useMemo<Slot[]>(() => {
    return (allBookings as any[])
      .filter((b) => b.user_id && !b.application_id)
      .map((b) => {
        const dateStr: string = b.booking_date || (b.scheduled_at ? new Date(b.scheduled_at).toLocaleDateString("en-CA") : "");
        const timeStr: string = (b.booking_time || (b.scheduled_at ? new Date(b.scheduled_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "")).slice(0, 5);
        const profile = profiles.find((p: any) => p.user_id === b.user_id);
        return {
          id: b.id,
          userId: b.user_id ?? null,
          assignmentId: b.assignment_id ?? null,
          status: b.status ?? "confirmed",
          dateStr,
          timeStr,
          ts: dateStr ? new Date(`${dateStr}T${timeStr || "00:00"}`).getTime() : 0,
          name: profile?.full_name || b.full_name || "Mitarbeiter",
          phone: profile?.phone || b.phone || null,
          profileId: profile?.id ?? null,
        };
      })
      .filter((s) => s.dateStr);
  }, [allBookings, profiles]);

  const assignmentIds = useMemo(() => new Set(assignments.map((a) => a.id)), [assignments]);
  const assignmentGroups = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assignments as any[]) m.set(a.id, a.assignment_group === "automatisch" ? "automatisch" : "manuell");
    return m;
  }, [assignments]);
  const now = Date.now();

  const filtered = slots.filter((s) => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (onlyOpen && s.assignmentId) return false;
    if (hidePast && s.ts < now) return false;
    return true;
  });

  const upcoming = filtered.filter((s) => s.ts >= now).sort((a, b) => a.ts - b.ts);
  const past = filtered.filter((s) => s.ts < now).sort((a, b) => b.ts - a.ts);
  const ordered = [...upcoming, ...past];

  const groups: { key: string; label: string; items: Slot[] }[] = [];
  for (const s of ordered) {
    const last = groups[groups.length - 1];
    if (last && last.key === s.dateStr) last.items.push(s);
    else groups.push({ key: s.dateStr, label: dayLabel(s.dateStr), items: [s] });
  }

  const openCount = slots.filter((s) => !s.assignmentId && s.ts >= now).length;

  const autoPlan = useMemo(
    () => planAutoAssignments(
      upcoming.filter((s) => s.status !== "cancelled"),
      assignments as any[],
      templates as any[],
    ),
    [upcoming, assignments, templates],
  );

  const handleAutoAssign = async () => {
    if (autoPlan.length === 0) return;
    setAutoRunning(true);
    const { created, failed } = await runAutoAssignments(autoPlan);
    setAutoRunning(false);
    toast({
      title: created > 0 ? `${created} Aufträge zugewiesen` : "Keine Zuweisung möglich",
      description: failed > 0 ? `${failed} fehlgeschlagen` : undefined,
      variant: created === 0 ? "destructive" : undefined,
    });
    await loadData();
  };

  if (loading) return <div className="p-6 space-y-4"><PageHeaderSkeleton /><TableSkeleton /></div>;

  return (
    <div className="p-5 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center">
            <CalendarDays className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-heading font-bold">Mitarbeiter-Termine</h1>
            <p className="text-xs text-muted-foreground">
              {upcoming.length} kommend · {openCount} ohne Auftrag
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={autoRunning || autoPlan.length === 0}
            onClick={handleAutoAssign}
          >
            {autoRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Automatisch zuweisen{autoPlan.length > 0 ? ` (${autoPlan.length})` : ""}
          </Button>
          <Input
            placeholder="Mitarbeiter suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-48 text-sm"
          />
          <Button size="sm" variant={onlyOpen ? "default" : "outline"} className="h-8 text-xs" onClick={() => setOnlyOpen((v) => !v)}>
            Nur offene
          </Button>
          <Button size="sm" variant={hidePast ? "default" : "outline"} className="h-8 text-xs" onClick={() => setHidePast((v) => !v)}>
            {hidePast ? "Vergangene anzeigen" : "Vergangene ausblenden"}
          </Button>
        </div>
      </div>

      {ordered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Keine Termine gefunden
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.key} className="space-y-1.5">
              <div className="flex items-center gap-2 px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</h2>
                <span className="text-[11px] text-muted-foreground">· {g.items.length}</span>
              </div>
              <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                {g.items.map((s) => {
                  const isPast = s.ts < now;
                  const cancelled = s.status === "cancelled";
                  const hasAssignment = !!s.assignmentId && assignmentIds.has(s.assignmentId);
                  const group = s.assignmentId ? assignmentGroups.get(s.assignmentId) : undefined;
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        "flex flex-wrap items-center gap-3 px-3 py-2.5 bg-card hover:bg-muted/30 transition-colors",
                        (isPast || cancelled) && "opacity-60",
                      )}
                    >
                      <span className="font-mono text-sm font-semibold w-14 shrink-0">{s.timeStr || "—"}</span>
                      <div className="min-w-[160px] flex-1">
                        <div className="text-sm font-medium truncate">{s.name}</div>
                      </div>

                      {cancelled ? (
                        <Badge variant="destructive" className="text-[10px]">Storniert</Badge>
                      ) : s.status === "no_show" ? (
                        <Badge variant="outline" className="text-[10px]">No-Show</Badge>
                      ) : null}

                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] border",
                          hasAssignment
                            ? group === "automatisch"
                              ? "bg-status-info/10 text-status-info border-status-info/25"
                              : "bg-status-success/15 text-status-success border-status-success/30"
                            : "bg-muted text-muted-foreground border-border",
                        )}
                      >
                        {hasAssignment
                          ? group === "automatisch" ? "Auto zugewiesen" : "Manuell zugewiesen"
                          : "Offen"}
                      </Badge>

                      <div className="flex items-center gap-1 ml-auto">
                        {hasAssignment ? (
                          <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1.5"
                            onClick={() => navigate(`/admin/assignments/${s.assignmentId}`)}
                          >
                            <ClipboardCheck className="h-3.5 w-3.5" /> Auftrag öffnen
                          </Button>
                          {isPast && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs gap-1.5"
                              onClick={() => setAssignFor(s)}
                            >
                              <Briefcase className="h-3.5 w-3.5" /> Neu zuweisen
                            </Button>
                          )}
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1.5"
                            disabled={cancelled}
                            onClick={() => setAssignFor(s)}
                          >
                            <Briefcase className="h-3.5 w-3.5" /> Zuweisen
                          </Button>
                        )}
                        {(s.profileId || s.userId) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => navigate(`/admin/personen/${s.profileId || s.userId}`)}
                          >
                            Öffnen <ExternalLink className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <AssignTaskDialog
        open={!!assignFor}
        onOpenChange={(o) => { if (!o) setAssignFor(null); }}
        userId={assignFor?.userId ?? null}
        bookingId={assignFor?.id ?? null}
        defaultReleaseAt={assignFor ? `${assignFor.dateStr}T${assignFor.timeStr || "09:00"}` : null}
      />
    </div>
  );
}
