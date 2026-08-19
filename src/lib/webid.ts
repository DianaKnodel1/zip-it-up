// Hilfsfunktionen rund um die WebID-Identifikation.
//
// Wichtig: Das Portal führt die Identifizierung NICHT selbst durch und bildet
// die WebID-Oberfläche auch nicht nach. Es öffnet ausschließlich die offizielle
// WebID-Seite (bzw. die vom Auftraggeber vorgegebene Einstiegs-URL) — mit deren
// Original-Hinweistexten. Hier wird lediglich die Ziel-URL zusammengebaut.

import { useTenant } from "@/contexts/TenantContext";

export type WebIdStatus = "offen" | "gestartet" | "bestaetigt" | "geprueft";

/**
 * Globaler Fallback für das WebID-Modul (greift nur, wenn kein Tenant
 * geladen ist bzw. die Spalte `webid_enabled` noch fehlt).
 * Der eigentliche Schalter liegt jetzt pro Unternehmen in
 * `tenants.webid_enabled` — im Portal unter „Domains / Tenants“.
 */
export const WEBID_ENABLED = false;

/**
 * Ist WebID für das aktuelle Unternehmen (Tenant) aktiv?
 * Nutzt den Tenant der aufgerufenen Domain — gilt für Admin- und
 * Mitarbeiter-Portal gleichermaßen.
 */
export function useWebIdEnabled(): boolean {
  const { tenant } = useTenant();
  const flag = (tenant as any)?.webid_enabled;
  return typeof flag === "boolean" ? flag : WEBID_ENABLED;
}

/** Fallback, falls im Auftrag keine eigene Einstiegs-URL hinterlegt ist. */
export const WEBID_DEFAULT_START_URL = "https://webid-solutions.de/";

export const WEBID_APP_LINKS = [
  { label: "WebID App (iOS)", href: "https://apps.apple.com/de/app/webid/id1050106340" },
  { label: "WebID App (Android)", href: "https://play.google.com/store/apps/details?id=de.webid.webidapp" },
];

/**
 * Baut die Start-URL für die Identifikation.
 *
 * Enthält die hinterlegte URL einen Platzhalter ({vorgangsnummer} / {case}),
 * wird die Vorgangsnummer dort eingesetzt. Sonst wird die URL unverändert
 * verwendet — der Mitarbeiter gibt die Nummer dann auf der WebID-Seite ein.
 */
export function buildWebIdStartUrl(startUrl: string | null | undefined, caseNumber: string | null | undefined): string {
  const base = (startUrl || "").trim() || WEBID_DEFAULT_START_URL;
  const nr = (caseNumber || "").trim();
  if (!nr) return base;
  if (/\{(vorgangsnummer|case|casenumber|tid)\}/i.test(base)) {
    return base.replace(/\{(vorgangsnummer|case|casenumber|tid)\}/gi, encodeURIComponent(nr));
  }
  return base;
}

export const WEBID_STATUS_LABEL: Record<WebIdStatus, { label: string; className: string }> = {
  offen: { label: "Offen", className: "bg-muted text-muted-foreground" },
  gestartet: { label: "Identifikation gestartet", className: "bg-status-pending/15 text-status-pending" },
  bestaetigt: { label: "Vom Mitarbeiter bestätigt", className: "bg-primary/15 text-primary" },
  geprueft: { label: "Geprüft", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
};
