import { createFileRoute } from "@tanstack/react-router";
import PortalAuthShell from "@/components/portal/PortalAuthShell";
import { PORTAL_THEMES, getPortalTheme, type PortalThemeId } from "@/lib/portal-themes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/portal-designs")({
  validateSearch: (search: Record<string, unknown>) => ({
    portal_theme: typeof search.portal_theme === "string" ? search.portal_theme : "clean",
  }),
  head: () => ({
    meta: [
      { title: "Portal-Designs – Vorschau der Login-Varianten" },
      { name: "description", content: "Vorschau der drei Portal-Designs für Login und Registrierung im Mitarbeiter-Portal." },
      { property: "og:title", content: "Portal-Designs – Vorschau" },
      { property: "og:description", content: "Drei Login-Designs für das Mitarbeiter-Portal im direkten Vergleich." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PortalDesignsPreview,
});

/** Reine Vorschau-Seite: zeigt die Auth-Designs mit einem Dummy-Formular. */
function PortalDesignsPreview() {
  const search = Route.useSearch();
  const theme = getPortalTheme(search.portal_theme);
  const t = theme.tokens;

  return (
    <>
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex gap-1.5 rounded-full border border-border bg-card/95 backdrop-blur px-2 py-1.5 shadow-lg">
        {PORTAL_THEMES.map((pt) => (
          <a
            key={pt.id}
            href={`/portal-designs?portal_theme=${pt.id}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              theme.id === pt.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {pt.name}
          </a>
        ))}
      </div>

      <PortalAuthShell themeId={theme.id as PortalThemeId} title="Willkommen zurück" description="Melde dich mit deinen Zugangsdaten an.">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className={t.label}>E-Mail</Label>
            <Input className={t.input} placeholder="name@firma.de" readOnly />
          </div>
          <div className="space-y-1.5">
            <Label className={t.label}>Passwort</Label>
            <Input className={t.input} type="password" placeholder="••••••••" readOnly />
          </div>
          <Button className={t.primaryButton}>Anmelden</Button>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className={`${t.dividerLabel} bg-transparent`}>oder</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button variant="outline" className={t.secondaryButton}>
            Neu registrieren
          </Button>
          <p className={t.mutedText}>Zugang vergessen? Wende dich an deinen Ansprechpartner.</p>
        </div>
      </PortalAuthShell>
    </>
  );
}
