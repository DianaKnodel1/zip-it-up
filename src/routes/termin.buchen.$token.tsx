import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { format, addDays, startOfDay, isSameDay, startOfWeek } from "date-fns";
import { de } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CalendarCheck, CalendarClock, CalendarDays, Clock, Loader2, UserRound } from "lucide-react";
import {
  getScheduleForApplicant,
  getAvailableSlots,
  bookAppointment,
} from "@/lib/appointments.functions";
import { useToast } from "@/hooks/use-toast";

export const Route = createFileRoute("/termin/buchen/$token")({
  validateSearch: (s: Record<string, unknown>) => ({
    rebook: s.rebook === "1" || s.rebook === 1 || s.rebook === true,
  }),
  head: () => ({
    meta: [
      { title: "Termin für Bewerbungsgespräch wählen" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BookingPage,
});

const DAYS_PER_VIEW = 28;

function BookingPage() {
  const { token } = Route.useParams();
  const { rebook } = Route.useSearch();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const scheduleFn = useServerFn(getScheduleForApplicant);
  const slotsFn = useServerFn(getAvailableSlots);
  const bookFn = useServerFn(bookAppointment);

  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(startOfDay(new Date()), { weekStartsOn: 1 }),
  );
  const [confirmed, setConfirmed] = useState<{
    starts_at: string;
    ends_at: string;
    cancel_token: string;
  } | null>(null);

  const info = useQuery({
    queryKey: ["schedule-for-applicant", token],
    queryFn: () => scheduleFn({ data: { token } }),
  });

  // Wenn bereits ein aktiver Termin existiert UND nicht explizit umbuchen:
  // → sanft auf die Termin-Verwaltung umleiten.
  useEffect(() => {
    if (rebook) return;
    if (confirmed) return;
    const d = info.data as any;
    const existing = d && d.existing_appointment;
    if (existing?.cancel_token) {
      navigate({ to: "/termin/$token", params: { token: existing.cancel_token }, replace: true });
    }
  }, [info.data, rebook, confirmed, navigate]);

  const fromDate = format(weekStart, "yyyy-MM-dd");
  const toDate = format(addDays(weekStart, DAYS_PER_VIEW - 1), "yyyy-MM-dd");

  const scheduleId = info.data && "ok" in info.data && info.data.ok ? info.data.schedule_id : null;

  const slotsQ = useQuery({
    queryKey: ["slots", scheduleId, fromDate, toDate],
    enabled: !!scheduleId,
    queryFn: () => slotsFn({ data: { schedule_id: scheduleId!, from_date: fromDate, to_date: toDate } }),
  });

  const days = useMemo(
    () => Array.from({ length: DAYS_PER_VIEW }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weeks = useMemo(() => {
    const out: Date[][] = [];
    for (let i = 0; i < DAYS_PER_VIEW; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days]);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, { start: string; end: string }[]>();
    (slotsQ.data?.slots ?? []).forEach(s => {
      const key = format(new Date(s.start), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [slotsQ.data]);

  const bookMutation = useMutation({
    mutationFn: async (starts_at: string) => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return bookFn({ data: { token, starts_at, applicant_timezone: tz } });
    },
    onSuccess: (res) => {
      if (!("ok" in res) || !res.ok) {
        const msg = res && "error" in res && res.error === "slot_taken"
          ? "Dieser Termin wurde gerade eben von jemand anderem gebucht. Bitte wählen Sie einen anderen."
          : res && "error" in res && res.error === "already_scheduled"
          ? "Sie haben bereits einen aktiven Termin. Bitte sagen Sie diesen zuerst ab."
          : "Buchung fehlgeschlagen. Bitte versuchen Sie es erneut.";
        toast({ title: "Nicht möglich", description: msg, variant: "destructive" });
        qc.invalidateQueries({ queryKey: ["slots"] });
        return;
      }
      setConfirmed({ starts_at: res.starts_at, ends_at: res.ends_at, cancel_token: res.cancel_token });
      try { window.parent?.postMessage({ type: "booking_completed", starts_at: res.starts_at, ends_at: res.ends_at }, "*"); } catch {}
    },
    onError: (e: any) => {
      toast({ title: "Fehler", description: e?.message ?? "Unbekannter Fehler", variant: "destructive" });
    },
  });

  if (info.isLoading) {
    return <CenterLoader />;
  }

  if (!info.data || !("ok" in info.data) || !info.data.ok) {
    const errCode = info.data && "error" in info.data ? info.data.error : "not_found";
    return (
      <CenterCard title={errCode === "no_schedule" ? "Buchung derzeit nicht möglich" : "Link ungültig"}>
        {errCode === "no_schedule" ? (
          "Für diese Stelle ist der Terminkalender aktuell nicht konfiguriert. Bitte kontaktieren Sie uns direkt."
        ) : (
          <>
            <span className="block">
              Dieser Buchungslink ist nicht mehr gültig — zum Beispiel, weil bereits ein neuer Termin
              gebucht wurde.
            </span>
            <a
              href="/bewerbung"
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              Mit E-Mail-Adresse fortfahren
            </a>
          </>
        )}
      </CenterCard>
    );
  }

  const s = info.data;

  if (confirmed) {
    return (
      <BookingConfirmed
        starts_at={confirmed.starts_at}
        ends_at={confirmed.ends_at}
        cancel_token={confirmed.cancel_token}
        tenantName={s.tenant_name ?? "das Unternehmen"}
        recruiterName={s.recruiter_name ?? "Martin Schneider"}
        applicantEmail={s.applicant_email ?? undefined}
        applicantFirstName={s.applicant_first_name ?? undefined}
        eventDescription={s.event_description ?? undefined}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/40 px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        {rebook && (
          <div className="mb-4 rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm text-foreground shadow-sm">
            <strong className="mb-1 block">Neuen Termin wählen</strong>
            Ihr bisheriger Termin wird erst beim Bestätigen des neuen Termins automatisch storniert.
          </div>
        )}
        <Card className="overflow-hidden border-border/80 shadow-xl shadow-primary/5">
          <CardHeader className="border-b bg-card px-5 py-6 sm:px-7">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
              <div className="min-w-0">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                  Bewerbungsgespräch buchen
                </div>
                <CardTitle className="text-2xl leading-tight sm:text-3xl">
                  Hallo{s.applicant_first_name ? ` ${s.applicant_first_name}` : ""}, wählen Sie Ihren Termin
                </CardTitle>
                <CardDescription className="mt-2 text-sm leading-relaxed">
                  Bewerbungsgespräch mit {s.recruiter_name ?? "Martin Schneider"}
                  {s.tenant_name ? ` · ${s.tenant_name}` : ""}
                </CardDescription>
              </div>
              <div className="hidden rounded-xl border bg-muted/30 px-4 py-3 text-sm sm:block">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Clock className="h-4 w-4 text-primary" /> {s.slot_duration_minutes} Min.
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="bg-muted/20 p-4 sm:p-7">
            <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm leading-relaxed shadow-sm">
              <div className="mb-3 flex items-center gap-2 font-semibold text-foreground">
                <CalendarCheck className="h-4 w-4 text-primary" /> So läuft Ihre Bewerbung ab
              </div>
              <ol className="space-y-2 text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">1. Termin wählen.</span>{" "}
                  Sie bekommen sofort eine Bestätigung per E-Mail – mit dem Link zum Gespräch.
                </li>
                <li>
                  <span className="font-medium text-foreground">2. Zur vereinbarten Uhrzeit teilnehmen.</span>{" "}
                  Das Interview findet online statt; die Teilnahme erfolgt über Ihren
                  persönlichen Zugangslink aus der Bestätigungsmail, ein Telefonanruf erfolgt nicht.
                  Dauer: ca. {s.slot_duration_minutes} Minuten.
                </li>
                <li>
                  <span className="font-medium text-foreground">3. Zusage im Gespräch.</span>{" "}
                  Passt alles, erhalten Sie Ihre Zusage direkt im Anschluss per E-Mail.
                </li>
                <li>
                  <span className="font-medium text-foreground">4. Im Mitarbeiter-Portal registrieren.</span>{" "}
                  Erst danach können wir Sie einsetzen – der letzte Schritt dauert nur wenige Minuten.
                </li>
              </ol>
            </div>

            {s.event_description && (
              <div className="mb-6 rounded-xl border border-primary/20 bg-background p-4 text-sm leading-relaxed shadow-sm">
                <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                  <UserRound className="h-4 w-4 text-primary" /> Hinweise zum Gespräch
                </div>
                <div className="whitespace-pre-wrap text-muted-foreground">{s.event_description}</div>
              </div>
            )}
            <div className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
              <div className="min-w-0">
                <div className="text-base font-semibold text-foreground">
                  Freie Termine der nächsten 4 Wochen
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Wählen Sie einfach die Uhrzeit, die Ihnen am besten passt.
                </div>
              </div>
              <div className="shrink-0 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                {format(weekStart, "d. MMM", { locale: de })} –{" "}
                {format(addDays(weekStart, DAYS_PER_VIEW - 1), "d. MMM yyyy", { locale: de })}
              </div>
            </div>

            {slotsQ.isLoading ? (
              <div className="py-16 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-7">
                {weeks.map((weekDays, wi) => (
                  <section key={wi} className="rounded-2xl border bg-background p-3 shadow-sm sm:p-4">
                    <div className="mb-3 flex items-center justify-between gap-3 border-b pb-3">
                      <div className="text-sm font-semibold text-foreground">
                        KW {format(weekDays[0], "w", { locale: de })}
                      </div>
                      <div className="text-xs font-medium text-muted-foreground">
                        {format(weekDays[0], "d. MMM", { locale: de })} – {format(weekDays[6], "d. MMM", { locale: de })}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
                      {weekDays.map(day => {
                        const key = format(day, "yyyy-MM-dd");
                        const slots = slotsByDay.get(key) ?? [];
                        const isToday = isSameDay(day, new Date());
                        return (
                          <div key={key} className="overflow-hidden rounded-xl border border-border bg-card">
                            <div className={`border-b px-3 py-2 text-center ${
                              isToday ? "bg-primary/10 text-primary" : "bg-muted/50 text-foreground"
                            }`}>
                              <div className="text-[11px] font-semibold uppercase text-muted-foreground">
                                {format(day, "EEE", { locale: de })}
                              </div>
                              <div className="text-base font-bold">
                                {format(day, "d.M.")}
                              </div>
                            </div>
                            <div className="grid min-h-[84px] grid-cols-2 gap-1.5 p-2 lg:grid-cols-1 xl:grid-cols-2">
                              {slots.length === 0 ? (
                                <div className="col-span-2 flex min-h-[64px] items-center justify-center rounded-lg bg-muted/30 text-xs text-muted-foreground lg:col-span-1 xl:col-span-2">
                                  keine Termine
                                </div>
                              ) : (
                                slots.map(slot => (
                                  <button
                                    key={slot.start}
                                    onClick={() => bookMutation.mutate(slot.start)}
                                    disabled={bookMutation.isPending}
                                    className="min-h-9 rounded-lg border border-border bg-background px-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
                                  >
                                    {format(new Date(slot.start), "HH:mm")}
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Sie erhalten nach der Buchung eine Bestätigung per E-Mail – inklusive Kalendereintrag.
        </p>
      </div>
    </div>
  );
}

function BookingConfirmed(props: {
  starts_at: string;
  ends_at: string;
  cancel_token: string;
  tenantName: string;
  recruiterName: string;
  applicantEmail?: string;
  applicantFirstName?: string;
  eventDescription?: string;
}) {

  const start = new Date(props.starts_at);
  const end = new Date(props.ends_at);
  const cancelUrl = typeof window !== "undefined"
    ? `${window.location.origin}/termin/${props.cancel_token}`
    : `/termin/${props.cancel_token}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 py-10 px-4">
      <div className="max-w-lg mx-auto">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <CalendarCheck className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Termin bestätigt</CardTitle>
            <CardDescription>
              Wir freuen uns auf das Gespräch mit Ihnen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4 bg-muted/40 text-center">
              <div className="text-sm text-muted-foreground">
                {format(start, "EEEE, d. MMMM yyyy", { locale: de })}
              </div>
              <div className="text-2xl font-semibold mt-1">
                {format(start, "HH:mm")} – {format(end, "HH:mm")} Uhr
              </div>
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm leading-relaxed">
              <div className="mb-2 font-semibold text-foreground">Wichtiger Hinweis zur Teilnahme</div>
              <p className="text-muted-foreground">
                Ihr <strong className="text-foreground">Interview</strong> findet online statt. Die Teilnahme
                erfolgt über Ihren persönlichen Zugangslink, den Sie soeben per E-Mail erhalten
                haben; ein Telefonanruf erfolgt nicht. Bitte öffnen Sie den Link zur vereinbarten
                Uhrzeit – er bleibt dauerhaft gültig, eine Installation ist nicht erforderlich.
              </p>
              <p className="mt-3 text-muted-foreground">
                Kommt die E-Mail nicht an, schauen Sie bitte im Spam-Ordner nach. Der Termin liegt
                als Kalendereintrag bei – zum Speichern in Outlook, Google oder Apple.
              </p>
            </div>

            <div className="rounded-lg border p-4 text-sm">
              <div className="mb-2 font-semibold text-foreground">Und danach?</div>
              <ol className="space-y-1.5 text-muted-foreground">
                <li>1. Gespräch führen (ca. {Math.round((end.getTime() - start.getTime()) / 60000)} Minuten)</li>
                <li>2. Zusage per E-Mail erhalten</li>
                <li>3. Im Mitarbeiter-Portal registrieren – erst danach können wir Sie einsetzen</li>
              </ol>
            </div>

            {props.eventDescription && (
              <div className="rounded-md border border-border bg-muted/40 p-4 text-sm whitespace-pre-wrap leading-relaxed">
                {props.eventDescription}
              </div>
            )}


            <div className="text-center text-sm">
              <a href={cancelUrl} className="text-primary hover:underline">
                Termin absagen oder verschieben
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CenterLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function CenterCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="max-w-md w-full">
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">{children}</CardContent>
      </Card>
    </div>
  );
}
