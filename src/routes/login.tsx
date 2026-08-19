import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login | Mitarbeiter Portal" },
      { name: "description", content: "Melden Sie sich in Ihrem Mitarbeiter-Portal an, um Ihre Aufgaben und Termine zu verwalten." },
      { property: "og:title", content: "Login | Mitarbeiter Portal" },
      { property: "og:description", content: "Sicherer Zugang zum Portal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

import { useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { translateAuthError } from "@/lib/auth-errors";
import { MailCheck } from "lucide-react";
import PortalAuthShell from "@/components/portal/PortalAuthShell";
import { usePortalTheme } from "@/hooks/use-portal-theme";


const LOGIN_TIMEOUT_MS = 15000;
const PROFILE_CHECK_TIMEOUT_MS = 10000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    }),
    timeoutPromise,
  ]);
}

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resending, setResending] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { tenant } = useTenant();
  const t = usePortalTheme().tokens;


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setNeedsVerify(false);
    setAuthError(null);
    let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["data"] | null = null;
    let error: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["error"] | null = null;
    try {
      const res = await withTimeout(
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
        LOGIN_TIMEOUT_MS,
        "Der Login-Server antwortet gerade nicht. Bitte prüfe, ob das Backend läuft.",
      );
      data = res.data;
      error = res.error;
    } catch (e: any) {
      const description = translateAuthError(e?.message) ?? "Unerwarteter Fehler. Bitte später erneut versuchen.";
      setAuthError(description);
      toast({
        title: "Anmeldung fehlgeschlagen",
        description,
        variant: "destructive",
      });
      setLoading(false);
      return;
    } finally {
      setLoading(false);
    }
    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("email not confirmed") || msg.includes("not confirmed")) {
        setNeedsVerify(true);
        setAuthError("Bitte bestätige zuerst deine E-Mail-Adresse. Wir haben dir einen Link gesendet.");
        toast({
          title: "E-Mail nicht bestätigt",
          description: "Bitte bestätige zuerst deine E-Mail-Adresse. Wir haben dir einen Link gesendet.",
          variant: "destructive",
        });
        return;
      }
      const description = translateAuthError(error.message);
      setAuthError(description);
      toast({ title: "Anmeldung fehlgeschlagen", description, variant: "destructive" });
      return;
    }
    if (data.user) {
      // E-Mail-Verifikation ist deaktiviert (GOTRUE_MAILER_AUTOCONFIRM=true).
      // Registrierung erfolgt über Invitation-Link – kein offener Signup.

      let profileRes: any;
      let roleRes: any;

      try {
        [profileRes, roleRes] = await withTimeout(
          Promise.all([
            supabase
              .from("profiles")
              .select("tenant_id, status")
              .eq("user_id", data.user.id)
              .maybeSingle(),
            supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", data.user.id),
          ]),
          PROFILE_CHECK_TIMEOUT_MS,
          "Login erfolgreich, aber die Profilprüfung antwortet nicht. Bitte prüfe die Datenbank/API-Verbindung.",
        );
      } catch (e: any) {
        const description = e?.message ?? "Login erfolgreich, aber die Profilprüfung ist fehlgeschlagen.";
        setAuthError(description);
        toast({ title: "Profilprüfung fehlgeschlagen", description, variant: "destructive" });
        await supabase.auth.signOut();
        return;
      }

      if (profileRes.error || roleRes.error) {
        const description = profileRes.error?.message || roleRes.error?.message || "Profil oder Rolle konnte nicht geladen werden.";
        setAuthError(description);
        toast({ title: "Profilprüfung fehlgeschlagen", description, variant: "destructive" });
        await supabase.auth.signOut();
        return;
      }

      const profile = profileRes.data;
      const roles: string[] = (roleRes.data ?? []).map((r: { role: string }) => r.role);
      const isAdminUser = roles.includes("admin");
      const isStaffUser = roles.includes("admin_mitarbeiter");

      if (profile?.status === "deaktiviert") {
        await supabase.auth.signOut();
        setAuthError("Dein Zugang wurde deaktiviert. Bitte kontaktiere deinen Ansprechpartner.");
        toast({ title: "Zugang deaktiviert", description: "Dein Zugang wurde deaktiviert. Bitte kontaktiere deinen Ansprechpartner.", variant: "destructive" });
        return;
      }

      if (!isAdminUser && tenant && profile && profile.tenant_id && profile.tenant_id !== tenant.id) {
        await supabase.auth.signOut();
        setAuthError("Bitte melde dich über deine Unternehmensseite an.");
        toast({ title: "Fehler", description: "Bitte melde dich über deine Unternehmensseite an.", variant: "destructive" });
        return;
      }

      if (isAdminUser) {
        navigate("/admin");
        return;
      }
      if (isStaffUser) {
        navigate("/admin/tasks");
        return;
      }
    }
    navigate("/dashboard");
  };

  const resendVerify = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || resending) return;
    const tenantId = tenant?.id;
    if (!tenantId) {
      toast({ title: "Fehler", description: "Tenant konnte nicht ermittelt werden. Bitte lade die Seite neu.", variant: "destructive" });
      return;
    }
    setResending(true);
    try {
      const { data, error } = await supabase.functions.invoke("resend-signup-confirmation", {
        body: { email: trimmedEmail, tenant_id: tenantId, redirect_to: `${window.location.origin}/auth/confirmed` },
      });
      if (error || (data as any)?.error) {
        toast({ title: "Fehler", description: (data as any)?.error ?? error?.message ?? "Versand fehlgeschlagen", variant: "destructive" });
      } else if ((data as any)?.already_confirmed) {
        toast({ title: "Bereits bestätigt", description: "Diese E-Mail ist schon aktiviert. Bitte melde dich an." });
      } else {
        toast({ title: "Bestätigungs-E-Mail versendet", description: `An ${trimmedEmail}` });
      }
    } finally {
      setResending(false);
    }
  };

  return (
    <PortalAuthShell
      title="Willkommen zurück"
      description="Melde dich an, um deine Aufträge, Termine und Dokumente zu verwalten."
    >
      {needsVerify && (
        <div className={t.warnBox}>
          <MailCheck className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="space-y-1.5 flex-1">
            <p className={t.warnText}>Bitte bestätige deine E-Mail-Adresse, bevor du dich anmeldest.</p>
            <button type="button" onClick={resendVerify} disabled={resending} className={t.warnAction}>
              Bestätigungslink erneut senden
            </button>
          </div>
        </div>
      )}

      {authError && !needsVerify && (
        <div className={t.errorBox} role="alert">
          {authError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="email" className={t.label}>
            E-Mail-Adresse
          </label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@unternehmen.de"
            autoComplete="email"
            className={t.input}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className={t.label}>
            Passwort
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            className={t.input}
            required
          />
        </div>

        <Button type="submit" size="lg" className={t.primaryButton} disabled={loading}>
          {loading ? "Wird angemeldet…" : "Anmelden"}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className={`${t.dividerLabel} bg-transparent text-[11px] uppercase tracking-wider`}>Neu hier?</span>
        <span className="h-px flex-1 bg-border" />
      </div>


      <Button size="lg" variant="outline" className={t.secondaryButton} onClick={() => navigate("/register")}>
        Konto erstellen
      </Button>
    </PortalAuthShell>
  );
}

