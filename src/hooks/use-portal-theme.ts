import { useTenant } from "@/contexts/TenantContext";
import { getPortalTheme, type PortalTheme } from "@/lib/portal-themes";

/**
 * Aktives Portal-Design des Tenants (Fallback: classic = bisheriges Aussehen).
 * Zum Ansehen/Abstimmen kann ein Design per URL überschrieben werden:
 * `/login?portal_theme=minimal` (nur Vorschau, ändert nichts am Tenant).
 */
export function usePortalTheme(): PortalTheme {
  const { tenant } = useTenant();
  let override: string | null = null;
  if (typeof window !== "undefined") {
    override = new URLSearchParams(window.location.search).get("portal_theme");
  }
  return getPortalTheme(override ?? tenant?.portal_theme ?? null);
}
