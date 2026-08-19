import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminListAppointmentsForApplication } from "@/lib/appointments.functions";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, XCircle, CheckCircle2, Clock } from "lucide-react";

function fmt(d?: string | null) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return ""; }
}

type Row = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  applicant_timezone: string | null;
  created_at: string;
};

function cancelledByLabel(by: string | null): string {
  if (!by) return "";
  if (by === "admin") return "Admin";
  if (by === "applicant") return "Bewerber";
  return by;
}

function statusMeta(status: string): { label: string; icon: any; className: string } {
  switch (status) {
    case "scheduled":
      return { label: "gebucht", icon: CalendarDays, className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" };
    case "cancelled":
      return { label: "abgesagt", icon: XCircle, className: "bg-muted text-muted-foreground" };
    case "completed":
      return { label: "wahrgenommen", icon: CheckCircle2, className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" };
    case "no_show":
      return { label: "nicht erschienen", icon: Clock, className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" };
    default:
      return { label: status, icon: CalendarDays, className: "bg-muted text-muted-foreground" };
  }
}

export function AppointmentHistory({ applicationId }: { applicationId: string }) {
  const fetchFn = useServerFn(adminListAppointmentsForApplication);
  const { data, isLoading } = useQuery({
    queryKey: ["appointment-history", applicationId],
    queryFn: () => fetchFn({ data: { application_id: applicationId } }),
    enabled: !!applicationId,
  });

  if (isLoading) return null;
  const rows = (data?.rows ?? []) as Row[];
  if (rows.length === 0) return null;

  // Wenn es einen aktuellen scheduled Termin gibt UND davor mind. eine Absage → "Neu gebucht nach Absage"
  const currentIdx = rows.findIndex(r => r.status === "scheduled");
  const hasEarlierCancel = rows.some(r => r.status === "cancelled");
  const showRebookHint = currentIdx === 0 && hasEarlierCancel;

  return (
    <div className="mt-3 border-t pt-3">
      <div className="text-xs font-medium text-foreground mb-2">
        Termin-Historie ({rows.length})
        {showRebookHint && (
          <span className="ml-2 text-emerald-700 dark:text-emerald-300 font-normal">
            · Neu gebucht nach Absage
          </span>
        )}
      </div>
      <ol className="space-y-2">
        {rows.map((r, i) => {
          const m = statusMeta(r.status);
          const Icon = m.icon;
          const isCancelled = r.status === "cancelled";
          return (
            <li key={r.id} className="flex items-start gap-2 text-xs">
              <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${isCancelled ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={isCancelled ? "line-through text-muted-foreground" : "text-foreground font-medium"}>
                    {fmt(r.starts_at)}
                  </span>
                  <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${m.className}`}>
                    {m.label}
                  </Badge>
                  {i === 0 && r.status === "scheduled" && (
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-300">aktuell</span>
                  )}
                </div>
                {isCancelled && r.cancelled_at && (
                  <div className="text-muted-foreground mt-0.5">
                    abgesagt am {fmt(r.cancelled_at)}
                    {r.cancelled_by && <> durch {cancelledByLabel(r.cancelled_by)}</>}
                    {r.cancel_reason && <> · Grund: {r.cancel_reason}</>}
                  </div>
                )}
                <div className="text-muted-foreground text-[10px] mt-0.5">
                  gebucht am {fmt(r.created_at)}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
