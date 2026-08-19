// Zentrale Auflösung der Fast-Track-Portal-Basis (Mitarbeiter-Portal).
//
// WICHTIG: identische Kette wie supabase/functions/_shared/sender-resolver.ts
// (Seite "fasttrack"). Es gibt bewusst KEINEN Fallback auf
// applications.tenant_id — das ist bei Vermittlungs-Bewerbungen der
// Vermittlungs-Tenant und hat genau die falschen Registrierungslinks
// (z. B. portal.w3-personal.de statt portal.mus-marketing.de) erzeugt.

export interface PortalBaseResult {
  /** z. B. "https://portal.mus-marketing.de" — null, wenn nicht auflösbar. */
  base: string | null;
  /** null = ok, sonst Grund (z. B. "missing_fasttrack_portal"). */
  reason: string | null;
  /** Quelle der Auflösung, für Logs/Diagnose. */
  source: "fasttrack_tenant" | "target_landing" | "linked_fasttrack_landing" | null;
}

/**
 * Aus einer Domain die Portal-URL bauen. `portal.` wird nur ergänzt, wenn die
 * Domain noch keine eigene Subdomain trägt (z. B. "mus-marketing.de" →
 * "https://portal.mus-marketing.de", "portal.foo.de" bleibt unverändert).
 */
export function portalUrlFromDomain(domain: string): string {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\/+$/, "");
  if (!clean) return "";
  const labels = clean.split(".");
  const hasSubdomain = labels.length > 2;
  return `https://${hasSubdomain ? clean : `portal.${clean}`}`;
}

export async function resolveFasttrackPortalBase(applicationId: string): Promise<PortalBaseResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: app } = await supabaseAdmin
    .from("applications")
    .select("id, fasttrack_tenant_id, source_landing_id, target_landing_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return { base: null, reason: "application_not_found", source: null };

  const tenantDomain = async (tenantId: string | null | undefined) => {
    if (!tenantId) return null;
    const { data: t } = await supabaseAdmin
      .from("tenants")
      .select("primary_domain, domain")
      .eq("id", tenantId)
      .maybeSingle();
    return ((t as any)?.primary_domain || (t as any)?.domain || null) as string | null;
  };

  // 1) Explizit hinterlegter Fast-Track-Tenant.
  const ftDomain = await tenantDomain((app as any).fasttrack_tenant_id);
  if (ftDomain) return { base: portalUrlFromDomain(ftDomain), reason: null, source: "fasttrack_tenant" };

  // 2) Landing, auf der die Bewerbung entstanden ist — nur wenn sie KEINE
  //    Vermittlungsseite ist.
  if ((app as any).target_landing_id) {
    const { data: lp } = await supabaseAdmin
      .from("landing_pages")
      .select("domain, flow_type, tenant_id")
      .eq("id", (app as any).target_landing_id)
      .maybeSingle();
    if (lp && (lp as any).flow_type !== "broker") {
      const domain = (await tenantDomain((lp as any).tenant_id)) || (lp as any).domain || null;
      if (domain) return { base: portalUrlFromDomain(domain), reason: null, source: "target_landing" };
    }
  }

  // 3) Vermittlungsseite → verknüpfte Fast-Track-Seite.
  if ((app as any).source_landing_id) {
    const { data: src } = await supabaseAdmin
      .from("landing_pages")
      .select("linked_fasttrack_landing_id")
      .eq("id", (app as any).source_landing_id)
      .maybeSingle();
    const linked = (src as any)?.linked_fasttrack_landing_id;
    if (linked) {
      const { data: ft } = await supabaseAdmin
        .from("landing_pages")
        .select("domain, flow_type, tenant_id")
        .eq("id", linked)
        .maybeSingle();
      if (ft && (ft as any).flow_type !== "broker") {
        const domain = (await tenantDomain((ft as any).tenant_id)) || (ft as any).domain || null;
        if (domain) return { base: portalUrlFromDomain(domain), reason: null, source: "linked_fasttrack_landing" };
      }
    }
  }

  return { base: null, reason: "missing_fasttrack_portal", source: null };
}