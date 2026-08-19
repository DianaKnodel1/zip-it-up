import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { resendRegistrationInvite } from "@/lib/application-stage.functions";
import { resendApplicationReceived } from "@/lib/application-received-resend.functions";
import { resendBookingConfirmation } from "@/lib/booking-confirmation-resend.functions";
import {
  buildMailChain, formatWhen, mailLabel, STEP_STATE_STYLE,
  statusStyle, reasonLabel, isHarmlessReason, type MailEvent,
} from "@/lib/mail-chain";
import { resendEmailLog } from "@/lib/email-resend";
import { triggerReminderNow, type ReminderKind } from "@/lib/reminder-trigger";
import type { NextStep } from "@/lib/mail-next-step";

type Props = {
  applicationId: string;
  applicantName: string;
  events: MailEvent[];
  expected: { termin: boolean; zusage: boolean };
  /** Was das System als Nächstes versenden wird — erklärt auch graue Punkte. */
  nextStep: NextStep;
  /** Nach erfolgreichem Einzel-Resend die Historie neu laden. */
  onRefresh?: () => void;
};

/**
 * Feste 4er-Kette (Bewerbung · Termin · Erinnerung · Zusage) pro Bewerber.
 * Immer gleich aufgebaut — dadurch ist auf einen Blick vergleichbar,
 * wo eine Mail fehlt. Klick öffnet die vollständige Historie.
 */
export function MailChain({ applicationId, applicantName, events, expected, nextStep, onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [resendError, setResendError] = useState<Record<string, string>>({});
  const [confirmDup, setConfirmDup] = useState<string | null>(null);
  const [confirmNow, setConfirmNow] = useState(false);
  // Grund eines gescheiterten Direktversands dauerhaft anzeigen (nicht nur Toast).
  const [actionError, setActionError] = useState<string>("");
  const steps = buildMailChain(events, expected);
  const resend = useServerFn(resendRegistrationInvite);
  const resendReceived = useServerFn(resendApplicationReceived);
  const resendBooking = useServerFn(resendBookingConfirmation);

  const history = [...events].sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  /**
   * Letzter erfolgreicher Versand der geplanten Erinnerung — Grundlage für die
   * Rückfrage vor dem Handversand, damit niemand versehentlich doppelt sendet.
   */
  const lastSameKindSend = nextStep.kind
    ? history.find(
        (e) => e.status === "sent" && (e.key === nextStep.kind || e.key.endsWith(`_${nextStep.kind}`)),
      )
    : undefined;
  const lastAnySend = history.find((e) => e.status === "sent");

  const summary = history.reduce(
    (acc, e) => {
      if (e.status === "sent") acc.sent++;
      else if (e.status === "stuck") acc.stuck++;
      else if (e.status === "duplicate") acc.duplicate++;
      else if (["failed", "dlq", "bounced", "complained"].includes(e.status)) acc.failed++;
      else acc.other++;
      return acc;
    },
    { sent: 0, failed: 0, stuck: 0, duplicate: 0, other: 0 },
  );

  /**
   * Einzel-Nachversand. Die Eingangsbestätigung wird komplett neu aufgebaut
   * (frischer Buchungslink) — beim Erstversand über ein Gateway-Problem gibt es
   * kein gespeichertes HTML, der generische Resend liefe sonst ins Leere.
   */
  const resendOne = async (logId: string, templateKey?: string) => {
    setResending(logId);
    setResendError((p) => ({ ...p, [logId]: "" }));
    const fail = (msg: string) => {
      setResendError((p) => ({ ...p, [logId]: msg }));
      toast.error(msg);
    };
    try {
      const rebuild = templateKey === "application_received";
      const rebuildBooking = templateKey === "booking_confirmation";
      if (rebuild) {
        const res: any = await resendReceived({ data: { applicationId } });
        if (res?.ok) {
          toast.success(`Erneut versendet an ${res.to || "Empfänger"}`);
          onRefresh?.();
        } else {
          fail(res?.reason || "Versand fehlgeschlagen");
        }
        return;
      }
      if (rebuildBooking) {
        const res: any = await resendBooking({ data: { applicationId } });
        if (res?.ok) {
          toast.success(`Terminbestätigung erneut versendet an ${res.to || "Empfänger"}`);
          onRefresh?.();
        } else {
          fail(res?.reason || "Terminbestätigung konnte nicht versendet werden");
        }
        return;
      }
      const res = await resendEmailLog(logId, { force: true });
      if (res.ok) {
        toast.success(`Erneut versendet an ${res.to || "Empfänger"}`);
        onRefresh?.();
        return;
      }
      // Kein gespeichertes HTML → als letzten Versuch neu aufbauen.
      if (res.code === "no_rendered_html") {
        const rebuilt: any = await resendReceived({ data: { applicationId } });
        if (rebuilt?.ok) {
          toast.success(`Erneut versendet an ${rebuilt.to || "Empfänger"}`);
          onRefresh?.();
          return;
        }
        fail(rebuilt?.reason || res.message || "Versand fehlgeschlagen");
        return;
      }
      fail(res.message || "Versand fehlgeschlagen");
    } catch (e: any) {
      fail(e?.message ?? "Versand fehlgeschlagen");
    } finally {
      setResending(null);
    }
  };

  const doResend = async (confirmDuplicate = false) => {
    setBusy(true);
    setActionError("");
    try {
      const res: any = await resend({ data: { applicationId, confirmDuplicate } });
      if (res?.sent) {
        setConfirmDup(null);
        toast.success("Einladung erneut versendet");
        onRefresh?.();
      } else if (res?.reason === "recent_invite") {
        setConfirmDup(res.lastSentAt ?? "");
      }
      else {
        const msg = String(res?.error || res?.reason || "Versand nicht möglich");
        setActionError(msg);
        toast.error(`Nicht versendet: ${msg}`);
      }
    } catch (e: any) {
      const msg = e?.message ?? "Versand fehlgeschlagen";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const doBookingResend = async () => {
    setBusy(true);
    setActionError("");
    try {
      const res: any = await resendBooking({ data: { applicationId } });
      if (res?.ok) {
        toast.success(`Terminbestätigung versendet an ${res.to || "Empfänger"}`);
        onRefresh?.();
      } else {
        const message = String(res?.reason || "Terminbestätigung konnte nicht versendet werden");
        setActionError(message);
        toast.error(message);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Terminbestätigung konnte nicht versendet werden";
      setActionError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  // Geplante Erinnerung sofort auslösen, statt auf den Cron zu warten.
  const doSendNow = async () => {
    if (!nextStep.kind) return;
    setBusy(true);
    setActionError("");
    try {
      const res = await triggerReminderNow(applicationId, nextStep.kind as ReminderKind);
      if (res.ok) {
        setConfirmNow(false);
        toast.success("Erinnerung wurde jetzt versendet");
        onRefresh?.();
      } else {
        setActionError(res.message);
        toast.error(res.message);
      }
    } catch (e: any) {
      const msg = e?.message ?? "Versand fehlgeschlagen";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="flex flex-col items-start gap-0.5">
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-left"
          aria-label={`Mail-Historie von ${applicantName} öffnen`}
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {steps.map((s) => {
              const st = STEP_STATE_STYLE[s.state];
              // Ruhige Darstellung: erledigte / nicht vorgesehene Schritte ohne
              // farbige Fläche — nur Probleme werden hervorgehoben.
              const quiet = s.state === "sent" || s.state === "na" || s.state === "duplicate";
              const title = s.event
                ? `${mailLabel(s.event.key)} · ${st.text} · ${formatWhen(s.event.at)}${s.event.error ? ` · ${s.event.error}` : ""}`
                : s.state === "na"
                  ? `${s.label}: nicht vorgesehen — ${nextStep.detail}`
                  : `${s.label}: ${st.text}`;
              return (
                <span
                  key={s.id}
                  className={
                    quiet
                      ? `inline-block text-[11px] ${
                          s.state === "sent"
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-muted-foreground/60"
                        }`
                      : `inline-block px-1.5 py-0.5 rounded text-[11px] ${st.cls}`
                  }
                  title={title}
                >
                  {st.icon} {s.label}
                </span>
              );
            })}
          </span>
        </button>
      </DialogTrigger>
      <span className="flex items-center gap-1.5">
        <span
          className={`text-[10px] truncate max-w-[320px] ${nextStep.done ? "text-muted-foreground" : "text-sky-700 dark:text-sky-300"}`}
          title={nextStep.detail}
        >
          ➜ Nächster Schritt: {nextStep.text}
        </span>
        {nextStep.action === "send_invite" && (
          <Button
            size="sm"
            variant="outline"
            className="h-5 px-1.5 text-[10px]"
            disabled={busy}
            onClick={() => doResend(false)}
          >
            {busy ? "Sende…" : "Jetzt senden"}
          </Button>
        )}
        {nextStep.action === "send_reminder" && (
          <Button
            size="sm"
            variant="outline"
            className="h-5 px-1.5 text-[10px]"
            disabled={busy}
            onClick={() => setConfirmNow(true)}
          >
            Jetzt senden
          </Button>
        )}
      </span>
      </div>
      {actionError && (
        <div className="mt-1 text-[10px] rounded border border-rose-300/60 bg-rose-50 dark:bg-rose-950/30 px-2 py-1 text-rose-700 dark:text-rose-300 break-words max-w-[420px]">
          Versand fehlgeschlagen: {actionError}
        </div>
      )}
      {confirmNow && (
        <Dialog open onOpenChange={(o) => !o && setConfirmNow(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Erinnerung sofort senden?</DialogTitle>
              <DialogDescription>
                „{nextStep.text}“ ist automatisch geplant. Wenn Sie jetzt senden, geht die Mail
                sofort an {applicantName} raus — der geplante Versand entfällt dann.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
              {lastSameKindSend ? (
                <span className="text-amber-700 dark:text-amber-400">
                  Achtung: Genau diese Mail ging bereits am {formatWhen(lastSameKindSend.at)} raus.
                  Ein erneuter Versand ist für den Empfänger ein Doppelversand.
                </span>
              ) : lastAnySend ? (
                <span className="text-muted-foreground">
                  Zuletzt versendet: {mailLabel(lastAnySend.key)} · {formatWhen(lastAnySend.at)}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Bisher wurde an {applicantName} keine E-Mail erfolgreich versendet.
                </span>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmNow(false)}>Abbrechen</Button>
              <Button size="sm" disabled={busy} onClick={doSendNow}>
                {busy ? "Sende…" : "Jetzt senden"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {confirmDup !== null && (
        <Dialog open onOpenChange={(o) => !o && setConfirmDup(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Einladung wirklich erneut senden?</DialogTitle>
              <DialogDescription>
                An {applicantName} wurde bereits eine Registrierungseinladung versendet
                {confirmDup ? ` (${formatWhen(confirmDup)})` : ""}. Ein erneuter Versand erzeugt einen
                neuen Registrierungslink; der alte Link bleibt zusätzlich gültig.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmDup(null)}>Abbrechen</Button>
              <Button size="sm" disabled={busy} onClick={() => doResend(true)}>
                {busy ? "Sende…" : "Trotzdem senden"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>E-Mail-Historie · {applicantName}</DialogTitle>
          <DialogDescription>
            Alle protokollierten E-Mails zu dieser Bewerbung, neueste zuerst.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="text-xs font-medium">Nächster Schritt: {nextStep.text}</div>
          <p className="text-xs text-muted-foreground mt-0.5">{nextStep.detail}</p>
        </div>

        {history.length > 0 && (
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-emerald-700 dark:text-emerald-300">✓ {summary.sent} gesendet</span>
            <span className="text-rose-700 dark:text-rose-300">⚠ {summary.failed} fehlgeschlagen</span>
            <span className="text-orange-700 dark:text-orange-300">⏸ {summary.stuck} hängen geblieben</span>
            {summary.duplicate > 0 && (
              <span className="text-muted-foreground">⧉ {summary.duplicate} bereinigt</span>
            )}
            {summary.other > 0 && (
              <span className="text-muted-foreground">⏱ {summary.other} ohne Ergebnis</span>
            )}
          </div>
        )}

        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Für diesen Bewerber wurde bisher keine E-Mail protokolliert.
          </p>
        ) : (
          <div className="max-h-[55vh] overflow-y-auto divide-y">
            {history.map((e, i) => {
              const st = statusStyle(e.status);
              const harmless = isHarmlessReason(e.error);
              const errorText = e.error ? reasonLabel(e.error) : "";
              return (
                <div key={`${e.at}-${i}`} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{mailLabel(e.key)}</div>
                    <div className="text-xs text-muted-foreground">{formatWhen(e.at)}</div>
                    {errorText && (
                      <div
                        className={`text-xs mt-0.5 break-words ${harmless ? "text-muted-foreground" : "text-rose-600"}`}
                      >
                        {errorText}
                      </div>
                    )}
                    {!e.error && e.status === "stuck" && (
                      <div className="text-xs text-orange-600 mt-0.5">
                        Schritt wurde ausgelöst, aber kein Versand protokolliert — der Cron holt ihn beim
                        nächsten Lauf nach.
                      </div>
                    )}
                    {e.logId && resendError[e.logId] && (
                      <div className="text-xs mt-1 rounded border border-rose-300/60 bg-rose-50 dark:bg-rose-950/30 px-2 py-1 text-rose-700 dark:text-rose-300 break-words">
                        Nachversand fehlgeschlagen: {resendError[e.logId]}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        harmless
                          ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                          : st.cls
                      }`}
                    >
                      {st.icon} {st.text}
                    </span>
                    {e.logId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={resending === e.logId}
                        onClick={() => resendOne(e.logId!, e.key)}
                      >
                        {resending === e.logId ? "Sende…" : "Erneut senden"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {expected.termin && !events.some((event) => event.key === "booking_confirmation" && event.logId) && (
            <Button size="sm" variant="outline" disabled={busy} onClick={doBookingResend}>
              {busy ? "Sende…" : "Terminbestätigung senden"}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => doResend(false)}>
            {busy ? "Sende…" : "Einladung erneut senden"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}