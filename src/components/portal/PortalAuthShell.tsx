import type { ReactNode } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { usePortalTheme } from "@/hooks/use-portal-theme";
import { getPortalTheme, type PortalThemeId } from "@/lib/portal-themes";
import officeBackground from "@/assets/portal-office-focus.jpg";
import atmosphereBackground from "@/assets/portal-brand-atmosphere.jpg";

/**
 * Gemeinsamer Rahmen für die Auth-Seiten des Portals.
 * Das Layout richtet sich nach dem gewählten Portal-Design des Tenants.
 * Die Formulare selbst bleiben unverändert und kommen als children herein.
 */
export default function PortalAuthShell({
  title,
  description,
  children,
  footer,
  width = "md",
  themeId,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg";
  themeId?: PortalThemeId;
}) {
  const { tenant } = useTenant();
  const activeTheme = usePortalTheme();
  const theme = themeId ? getPortalTheme(themeId) : activeTheme;
  const t = theme.tokens;
  const name = tenant?.name ?? "Mitarbeiter-Portal";
  const maxW = width === "lg" ? "max-w-lg" : "max-w-md";
  const onImage = theme.tokens.decor === "image";
  const tenantBackground = tenant?.portal_background_url;
  const bgUrl = tenantBackground || (theme.id === "atmosphere" ? atmosphereBackground : officeBackground);

  const brandMark = (
    <div className="flex items-center gap-2.5">
      {tenant?.logo_url ? (
        <img src={tenant.logo_url} alt={name} className="h-8 w-auto" />
      ) : (
        <span
          className="h-8 w-8 rounded-md flex items-center justify-center text-sm font-semibold bg-card text-foreground"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span
        className={`font-heading font-semibold text-sm tracking-tight ${
          onImage ? "text-primary-foreground [text-shadow:0_1px_3px_rgb(0_0_0/0.5)]" : "text-foreground"
        }`}
      >
        {name}
      </span>

    </div>
  );

  const formBlock = (
    <div className={`w-full ${maxW} relative`}>
      <div className={t.card}>
        <div className={t.cardPadding}>
          <div className="space-y-2">
            <h1 className={t.heading}>{title}</h1>
            {description && <p className={t.subText}>{description}</p>}
          </div>
          {children}
        </div>
      </div>

      {footer}
    </div>
  );

  // Split-Layout: Markenfläche links, Formular rechts.
  if (t.brandPanel) {
    return (
      <div className={t.page}>
        <aside className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-muted/40 border-r border-border p-12 xl:p-16">
          {brandMark}
          <div className="space-y-4 max-w-md">
            <h2 className="text-3xl xl:text-4xl font-heading font-semibold leading-tight tracking-tight text-foreground">
              Dein Zugang zum Arbeitsbereich.
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground">
              Aufträge, Termine und Dokumente — übersichtlich an einem Ort.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">{name}</span>
        </aside>

        <div className="flex-1 flex flex-col">
          <header className="lg:hidden px-6 pt-6">{brandMark}</header>
          <main className="flex-1 flex items-center justify-center p-6 sm:p-10">{formBlock}</main>
        </div>
      </div>
    );
  }

  return (
    <div className={t.page}>
      {onImage && (
        <>
          <img
            src={bgUrl}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover ${
              theme.id === "atmosphere" ? "scale-105 blur-[2px]" : ""
            }`}
            width={1920}
            height={1280}
            aria-hidden
          />
          {/* Verlauf: oben leicht, unten kräftig — Bild bleibt erkennbar, Texte lesbar. */}
          <div
            className="absolute inset-0 bg-gradient-to-b from-foreground/45 via-foreground/35 to-foreground/70"
            aria-hidden
          />
        </>
      )}


      {t.decor === "glow" && (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,hsl(var(--primary)/0.10),transparent_55%)] pointer-events-none" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_85%,hsl(var(--primary)/0.06),transparent_55%)] pointer-events-none" />
        </>
      )}

      <header className="relative z-10 px-6 sm:px-10 pt-6">{brandMark}</header>
      <main className="relative z-10 flex-1 flex items-center justify-center p-6 sm:p-10">{formBlock}</main>
    </div>
  );
}
