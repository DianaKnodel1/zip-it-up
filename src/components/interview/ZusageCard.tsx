// Zusage-Screen: wird direkt im Portal angezeigt, sobald die KI eine Zusage
// erteilt hat — optisch angelehnt an die „Willkommen im Team"-E-Mail.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";

export function ZusageCard({
  company,
  primary,
  recruiter,
  firstName,
  registrationLink,
  loginHref,
  className,
  mailFailed,
}: {
  company: string;
  primary: string;
  recruiter: string;
  firstName?: string | null;
  /** Persönlicher Registrierungslink (mit Token) aus der Zusage-Mail. */
  registrationLink?: string | null;
  loginHref?: string;
  className?: string;
  /** true = die Zusage-Mail konnte nicht zugestellt werden → Link hier direkt nutzen. */
  mailFailed?: boolean;
}) {
  const login = loginHref || "/login";
  // Registrierung sofort abschliessen statt auf die E-Mail zu warten:
  // liegt der persönliche Link vor, leiten wir automatisch weiter.
  const [seconds, setSeconds] = useState(8);
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    if (!registrationLink || stopped) return;
    if (seconds <= 0) {
      window.location.href = registrationLink;
      return;
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [registrationLink, seconds, stopped]);
  return (
    <div
      className={`bg-white dark:bg-slate-900 rounded-2xl border-2 p-6 sm:p-8 space-y-5 text-center shadow-lg ${className ?? ""}`}
      style={{ borderColor: primary }}
    >
      <div className="text-5xl leading-none">🎉</div>
      <div className="space-y-1">
        <h2 className="text-2xl font-bold leading-tight">Willkommen im Team!</h2>
        <p className="text-sm text-muted-foreground">Wir freuen uns, dass Sie dabei sind.</p>
      </div>

      <p className="text-[15px] text-foreground leading-relaxed">
        {firstName ? `${firstName}, Ihr` : "Ihr"} Profil hat uns überzeugt – lassen Sie uns direkt starten!
      </p>

      <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-border p-4 text-left">
        <p className="text-sm font-semibold mb-3">Wie geht es weiter?</p>
        <ol className="space-y-2.5">
          {[
            `Registrieren Sie sich im Mitarbeiterportal von ${company}`,
            "Führen Sie anschließend das Onboarding durch (Arbeitsvertrag & Personalausweis)",
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-foreground">
              <span
                className="h-6 w-6 shrink-0 rounded-full text-white text-xs font-semibold flex items-center justify-center"
                style={{ background: primary }}
              >
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {registrationLink ? (
        <>
        <Button
          asChild
          size="lg"
          className="w-full font-semibold text-base h-12 shadow-md hover:shadow-lg transition-shadow"
          style={{ background: primary }}
        >
          <a href={registrationLink}>
            <UserPlus className="h-5 w-5 mr-2" />
            Jetzt registrieren – direkt hier abschließen
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">
          {stopped ? (
            <>Klicken Sie oben, um Ihre Registrierung abzuschließen.</>
          ) : (
            <>
              Sie werden in {seconds} Sekunden automatisch zur Registrierung weitergeleitet.{" "}
              <button type="button" onClick={() => setStopped(true)} className="underline hover:text-foreground">
                Nicht weiterleiten
              </button>
            </>
          )}
        </p>
        {mailFailed && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            ✉️ Die Bestätigungs-E-Mail ist noch unterwegs. Nutzen Sie zur Sicherheit
            direkt den Button oben — der Link funktioniert auch ohne E-Mail.
          </div>
        )}
        </>
      ) : (
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
          📬 Sie erhalten in wenigen Minuten eine E-Mail mit Ihrem persönlichen
          Registrierungslink. Bitte auch den Spam-Ordner prüfen.
        </div>
      )}

      <p className="text-xs text-muted-foreground leading-relaxed">
        ⏱️ Dauert nur 5 Minuten · 📄 Vertrag digital unterschreiben · 🚀 Sofort startklar
        <br />
        Bitte bereithalten: <strong>Personalausweis</strong>, <strong>IBAN</strong>, <strong>Steuer-ID</strong>.
      </p>

      <div className="pt-3 border-t border-border text-xs text-muted-foreground space-y-1">
        <p>Ich wünsche Ihnen einen erfolgreichen Start!</p>
        <p>
          Mit freundlichen Grüßen
          <br />
          <strong className="text-foreground">{recruiter}</strong>
          <br />
          HR Management · {company}
        </p>
        <p>
          Bereits registriert?{" "}
          <a href={login} className="underline hover:text-foreground">
            Zum Login
          </a>
        </p>
      </div>
    </div>
  );
}