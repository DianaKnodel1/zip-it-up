/**
 * Portal-Designs (Themes) für die Auth-Seiten des Mitarbeiter-Portals:
 * Login, Registrierung, Passwort vergessen.
 *
 * Auswahl erfolgt im Landing-Generator (nur Fast-Track) und wird am Tenant
 * gespeichert (`tenants.portal_theme`). Ohne Auswahl gilt "clean".
 *
 * Stand 2026-07: drei schlichte Varianten: hell, Office-Foto und Markenbild.
 */

export type PortalThemeId = "clean" | "office" | "atmosphere";

export interface PortalThemeTokens {
  /** Äußerer Seitenrahmen */
  page: string;
  /** Dekoration im Hintergrund */
  decor: "none" | "glow" | "image";
  /** Marken-Seitenpanel links (nur split) */
  brandPanel: boolean;
  /** Karte mit dem Formular */
  card: string;
  cardPadding: string;
  heading: string;
  subText: string;
  label: string;
  input: string;
  primaryButton: string;
  secondaryButton: string;
  mutedText: string;
  dividerLine: string;
  dividerLabel: string;
  warnBox: string;
  warnText: string;
  warnAction: string;
  errorBox: string;
  /** Registrierungs-Wizard (nutzt eigene Karte) */
  wizardPage: string;
  wizardCard: string;
}

export interface PortalTheme {
  id: PortalThemeId;
  name: string;
  description: string;
  tokens: PortalThemeTokens;
}

const clean: PortalThemeTokens = {
  page: "min-h-screen flex flex-col bg-muted/30 font-sans",
  decor: "none",
  brandPanel: false,
  card: "rounded-xl border border-border bg-card shadow-sm",
  cardPadding: "p-7 sm:p-9 space-y-6",
  heading: "text-xl font-heading font-semibold text-foreground",
  subText: "font-sans text-sm text-muted-foreground leading-relaxed",
  label: "font-sans text-sm font-medium text-foreground",
  input: "h-11 font-sans",
  primaryButton: "w-full h-11 font-sans text-sm font-semibold",
  secondaryButton: "w-full h-11 font-sans text-sm font-medium",
  mutedText: "font-sans text-xs text-muted-foreground",
  dividerLine: "w-full border-t border-border",
  dividerLabel: "bg-card px-3 font-sans text-muted-foreground",
  warnBox: "rounded-lg border border-border bg-muted/50 p-3 flex items-start gap-3",
  warnText: "font-sans text-xs text-foreground",
  warnAction: "font-sans text-xs font-medium text-primary underline hover:no-underline",
  errorBox: "rounded-lg border border-destructive/30 bg-destructive/10 p-3 font-sans text-sm text-destructive",
  wizardPage: "min-h-screen flex items-center justify-center bg-muted/30 p-4 font-sans",
  wizardCard: "w-full max-w-lg border border-border bg-card shadow-sm",
};

const office: PortalThemeTokens = {
  ...clean,
  page: "min-h-screen flex flex-col relative overflow-hidden bg-background font-sans",
  decor: "image",
  card: "rounded-xl border border-border/60 bg-card shadow-2xl",
  cardPadding: "p-7 sm:p-9 space-y-6",
  heading: "text-2xl font-heading font-semibold text-foreground",
  dividerLabel: "bg-card px-3 font-sans text-muted-foreground",
  wizardPage: "min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-background font-sans",
  wizardCard: "w-full max-w-lg rounded-xl border border-border/60 bg-card shadow-2xl",
};

const atmosphere: PortalThemeTokens = {
  ...office,
  card: "rounded-2xl border border-border/50 bg-card shadow-2xl",
  cardPadding: "p-8 sm:p-10 space-y-6",
};


export const PORTAL_THEMES: PortalTheme[] = [
  {
    id: "clean",
    name: "Clean Corporate",
    description: "Ruhige, helle Login-Seite mit klarer Hierarchie und Logo oben links.",
    tokens: clean,
  },
  {
    id: "office",
    name: "Office Focus",
    description: "Helles Bürobild, leicht abgedunkelt, mit schlichter weißer Login-Karte.",
    tokens: office,
  },
  {
    id: "atmosphere",
    name: "Brand Atmosphere",
    description: "Atmosphärisches Markenbild mit dezenter Unschärfe und ruhiger Formkarte.",
    tokens: atmosphere,
  },
];

export const DEFAULT_PORTAL_THEME: PortalThemeId = "clean";

export function getPortalTheme(id?: string | null): PortalTheme {
  const legacy: Record<string, PortalThemeId> = {
    classic: "clean",
    minimal: "clean",
    split: "clean",
    image: "office",
    soft: "atmosphere",
  };
  const normalized = id ? (legacy[id] ?? id) : DEFAULT_PORTAL_THEME;
  return PORTAL_THEMES.find((t) => t.id === normalized) ?? PORTAL_THEMES[0];
}
