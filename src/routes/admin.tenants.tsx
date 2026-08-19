import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/tenants")({
  component: AdminTenantsPage,
});

import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/image-compression";
import { useAllTenants, type Tenant } from "@/hooks/use-tenant";
import { switchToNewPrimaryDomain } from "@/lib/tenant-domains.functions";
import { setLandingDnsRecord } from "@/lib/cloudflare.functions";
// IP des Portal-Servers (Frontend). DNS-A-Record für portal.<tenant-domain>
// wird beim Speichern eines Tenants automatisch in Cloudflare angelegt/aktualisiert.
const PORTAL_SERVER_IP = "190.97.167.124";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { Globe, Plus, Pencil, Trash2, User, Mail, Loader2, AlertTriangle, CheckCircle2, PenTool, ArrowRightLeft } from "lucide-react";
import { TableSkeleton, PageHeaderSkeleton } from "@/components/SkeletonLoaders";
import { SignatureGenerator } from "@/components/SignatureGenerator";
import { TenantReadinessBadge, TenantReadinessDialog, useTenantReadiness } from "@/components/admin/TenantReadinessPanel";


function TenantForm({ tenant, onSaved }: { tenant?: Tenant; onSaved: () => void }) {
  // (SmtpHealthRow siehe unten – Health-Status je Tenant)
  const [name, setName] = useState(tenant?.name ?? "");
  const [domain, setDomain] = useState(tenant?.domain ?? "");
  const [domainAliases, setDomainAliases] = useState<string>(
    ((tenant as any)?.domain_aliases as string[] | undefined ?? []).join("\n")
  );
  const [primaryColor, setPrimaryColor] = useState(tenant?.primary_color ?? "#000000");
  const [heroTitle, setHeroTitle] = useState(tenant?.hero_title ?? "Werde Teil unseres Teams");
  const [heroSubtitle, setHeroSubtitle] = useState(tenant?.hero_subtitle ?? "");
  const [senderEmail, setSenderEmail] = useState(tenant?.sender_email ?? "");
  const [senderName, setSenderName] = useState(tenant?.sender_name ?? "");
  const [leaderName, setLeaderName] = useState(tenant?.team_leader_name ?? "Teamleiter");
  const [leaderTitle, setLeaderTitle] = useState(tenant?.team_leader_title ?? "Dein Ansprechpartner");
  const [leaderOnline, setLeaderOnline] = useState(tenant?.team_leader_online ?? true);
  const [leaderResponseTime, setLeaderResponseTime] = useState(tenant?.team_leader_response_time ?? "Antwortet in wenigen Minuten");
  const [leaderAvatarUrl, setLeaderAvatarUrl] = useState<string | null>(tenant?.team_leader_avatar_url ?? null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [whatsappNumber, setWhatsappNumber] = useState((tenant as any)?.whatsapp_number ?? "");
  const [companyAddress, setCompanyAddress] = useState(tenant?.company_address ?? "");
  const [companyContactPerson, setCompanyContactPerson] = useState(tenant?.company_contact_person ?? "");
  const [companySignerName, setCompanySignerName] = useState(tenant?.company_signer_name ?? "");
  const [companySignerTitle, setCompanySignerTitle] = useState(tenant?.company_signer_title ?? "");
  const [companyEmail, setCompanyEmail] = useState(tenant?.company_email ?? "");
  const [companyCity, setCompanyCity] = useState((tenant as any)?.company_city ?? "");
  const [companyCeoName, setCompanyCeoName] = useState((tenant as any)?.company_ceo_name ?? "");
  const [contractAdditions, setContractAdditions] = useState(tenant?.contract_additions ?? "");
  const [allowedEmploymentTypes, setAllowedEmploymentTypes] = useState<string[]>(
    ((tenant as any)?.allowed_employment_types as string[] | undefined) ?? ["minijob", "teilzeit", "vollzeit"]
  );
  const [webidEnabled, setWebidEnabled] = useState<boolean>(!!(tenant as any)?.webid_enabled);
  const [replyToEmail, setReplyToEmail] = useState((tenant as any)?.reply_to_email ?? "");
  const [welcomeSubject, setWelcomeSubject] = useState((tenant as any)?.welcome_email_subject ?? "Willkommen im Team!");
  const [welcomeBody, setWelcomeBody] = useState((tenant as any)?.welcome_email_body ?? "");
  const [emailSignature, setEmailSignature] = useState((tenant as any)?.email_signature ?? "");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const setDnsFn = useServerFn(setLandingDnsRecord);
  const leaderInitials = (leaderName || "T").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !domain.trim()) {
      toast({ title: "Fehler", description: "Name und Domain sind Pflichtfelder.", variant: "destructive" });
      return;
    }
    // Erlaubte Domains: Haupt-Domain + alle Aliase + primary_domain
    const tenantDomain = domain.trim().toLowerCase();
    const aliasDomainList = domainAliases
      .split(/[\n,;]+/)
      .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
      .filter((s) => s.length > 2);
    const primaryDom = ((tenant as any)?.primary_domain ?? "").toLowerCase().trim();
    const allowedDomains = [tenantDomain, primaryDom, ...aliasDomainList].filter(Boolean);
    const matchesAllowed = (emailDomain: string) =>
      allowedDomains.some((d) => emailDomain === d || emailDomain.endsWith("." + d));
    if (senderEmail.trim()) {
      const emailDomain = senderEmail.trim().split("@")[1]?.toLowerCase();
      if (emailDomain && !matchesAllowed(emailDomain)) {
        toast({ title: "Fehler", description: `Absender-E-Mail muss zur Tenant-Domain oder einem Alias passen (${allowedDomains.join(", ")}). Beispiel: info@${tenantDomain}.`, variant: "destructive" });
        return;
      }
    }
    if (companyEmail.trim()) {
      const emailDomain = companyEmail.trim().split("@")[1]?.toLowerCase();
      if (emailDomain && !matchesAllowed(emailDomain)) {
        toast({ title: "Fehler", description: `Kontakt-E-Mail muss zur Tenant-Domain oder einem Alias passen.`, variant: "destructive" });
        return;
      }
    }
    setLoading(true);
    // Aliases: pro Zeile eine Domain, getrimmt, dedupliziert, ohne Primary
    const aliasList = Array.from(new Set(
      domainAliases
        .split(/[\n,;]+/)
        .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
        .filter((s) => s.length > 2 && s !== domain.trim().toLowerCase())
    ));
    const payload = {
      name: name.trim(),
      domain: domain.trim().toLowerCase(),
      domain_aliases: aliasList,
      primary_color: primaryColor,
      hero_title: heroTitle.trim(),
      hero_subtitle: heroSubtitle.trim(),
      sender_email: null,
      sender_name: null,
      team_leader_name: leaderName.trim() || "Teamleiter",
      team_leader_title: leaderTitle.trim() || "Dein Ansprechpartner",
      team_leader_online: leaderOnline,
      team_leader_response_time: leaderResponseTime.trim() || "Antwortet in wenigen Minuten",
      team_leader_avatar_url: leaderAvatarUrl,
      whatsapp_number: whatsappNumber.trim() || null,
      company_address: companyAddress.trim() || null,
      company_contact_person: companyContactPerson.trim() || null,
      company_signer_name: companySignerName.trim() || null,
      company_signer_title: companySignerTitle.trim() || null,
      company_email: companyEmail.trim() || null,
      company_city: companyCity.trim() || null,
      company_ceo_name: companyCeoName.trim() || null,
      contract_additions: contractAdditions.trim() || null,
      allowed_employment_types:
        allowedEmploymentTypes.length > 0 ? allowedEmploymentTypes : ["minijob", "teilzeit", "vollzeit"],
      webid_enabled: webidEnabled,
      reply_to_email: replyToEmail.trim() || null,
      welcome_email_subject: welcomeSubject.trim() || "Willkommen im Team!",
      welcome_email_body: welcomeBody.trim() || null,
      email_signature: emailSignature.trim() || null,
    };

    const { error } = tenant
      ? await supabase.from("tenants").update(payload as any).eq("id", tenant.id)
      : await supabase.from("tenants").insert(payload as any);

    setLoading(false);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: tenant ? "Domain aktualisiert" : "Domain hinzugefügt" });

    // portal.<domain> A-Record NUR für FASTTRACK-Landings anlegen.
    // Classic/Broker leiten nicht ins Portal → kein Subdomain nötig.
    const tenantIdForCheck = tenant?.id;
    let hasFastLanding = false;
    if (tenantIdForCheck) {
      const { data: fastRows } = await supabase
        .from("landing_pages")
        .select("id")
        .eq("tenant_id", tenantIdForCheck)
        .eq("flow_type", "fast")
        .limit(1);
      hasFastLanding = !!(fastRows && fastRows.length);
    }
    if (hasFastLanding) {
      const dnsHosts = [payload.domain, ...aliasList].map((d) => `portal.${d}`);
      for (const portalHost of dnsHosts) {
        try {
          await setDnsFn({ data: { domain: portalHost, ip: PORTAL_SERVER_IP, proxied: true } });
          toast({ title: "DNS gesetzt", description: `${portalHost} → ${PORTAL_SERVER_IP}` });
        } catch (err: any) {
          toast({
            title: "DNS nicht automatisch gesetzt",
            description: `${portalHost}: ${err?.message ?? "Cloudflare-Zone fehlt? Erst Zonen syncen."} — manuell anlegen.`,
            variant: "destructive",
          });
        }
      }
    } else {
      toast({
        title: "portal.<domain> übersprungen",
        description: "Kein Fasttrack-Landing für diesen Tenant — DNS-Record wird nicht benötigt.",
      });
    }

    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Domain & Branding</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="BCU Theme" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Domain *</Label>
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="bcutheme.de" className="mt-1" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Fallback-Domains (Aliases)</Label>
          <Textarea
            value={domainAliases}
            onChange={(e) => setDomainAliases(e.target.value)}
            placeholder={"bcutheme.com\nbcu-portal.de"}
            className="mt-1 font-mono text-xs"
            rows={3}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Eine Domain pro Zeile. Wird die Primary-Domain (z.B. <code>.de</code>) blockiert oder vom Registrar geflaggt,
            kannst du jederzeit eine Alias-Domain zur neuen Primary machen — alle neuen Login-Mails gehen dann darüber raus,
            ohne Code-Deploy. Bewerber, die <code>portal.&lt;alias&gt;</code> aufrufen, landen ebenfalls im richtigen Tenant.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Primärfarbe</Label>
            <div className="flex items-center gap-2 mt-1">
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-9 w-12 rounded border cursor-pointer" />
              <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="flex-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Absendername</Label>
            <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="BCU Theme Team" className="mt-1" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Absender-E-Mail</Label>
          <Input value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} placeholder="info@bcutheme.de" className="mt-1" />
          {(() => {
            const ed = senderEmail.trim().split("@")[1]?.toLowerCase();
            if (!ed) return null;
            const td = domain.trim().toLowerCase();
            const aliases = domainAliases.split(/[\n,;]+/).map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter((s) => s.length > 2);
            const pd = ((tenant as any)?.primary_domain ?? "").toLowerCase().trim();
            const allowed = [td, pd, ...aliases].filter(Boolean);
            const ok = allowed.some((d) => ed === d || ed.endsWith("." + d));
            if (ok) return null;
            return (
              <div className="mt-2 flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/30">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                <p className="text-[10px] text-foreground">
                  Sender-Domain <code className="font-mono">{ed}</code> passt nicht zur Tenant-Domain oder einem Alias ({allowed.join(", ")}). Mails landen wahrscheinlich im Spam und Tenant-Isolation ist gefährdet.
                </p>
              </div>
            );
          })()}
        </div>
        <div>
          <Label className="text-xs">Hero-Titel</Label>
          <Input value={heroTitle} onChange={(e) => setHeroTitle(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Hero-Untertitel</Label>
          <Input value={heroSubtitle} onChange={(e) => setHeroSubtitle(e.target.value)} className="mt-1" />
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Unternehmensdaten (für Verträge)</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Firmenadresse</Label>
            <Input value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} placeholder="Musterstr. 1, 10115 Berlin" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Kontakt-E-Mail</Label>
            <Input value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} placeholder="info@firma.de" className="mt-1" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Ansprechpartner</Label>
            <Input value={companyContactPerson} onChange={(e) => setCompanyContactPerson(e.target.value)} placeholder="Max Mustermann" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Unterzeichner</Label>
            <Input value={companySignerName} onChange={(e) => setCompanySignerName(e.target.value)} placeholder="Max Mustermann" className="mt-1" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Unterzeichner-Titel</Label>
            <Input value={companySignerTitle} onChange={(e) => setCompanySignerTitle(e.target.value)} placeholder="Geschäftsführer" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Stadt</Label>
            <Input value={companyCity} onChange={(e) => setCompanyCity(e.target.value)} placeholder="Berlin" className="mt-1" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Geschäftsführer / CEO Name</Label>
          <Input value={companyCeoName} onChange={(e) => setCompanyCeoName(e.target.value)} placeholder="Max Mustermann" className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Vertragszusätze</Label>
          <Textarea value={contractAdditions} onChange={(e) => setContractAdditions(e.target.value)} placeholder="Zusätzliche Vertragsklauseln…" rows={3} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Wählbare Vertragsarten (Registrierung)</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["minijob", "teilzeit", "vollzeit"] as const).map((v) => {
              const active = allowedEmploymentTypes.includes(v);
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() =>
                    setAllowedEmploymentTypes((prev) => {
                      const next = active ? prev.filter((p) => p !== v) : [...prev, v];
                      return next.length > 0 ? next : prev; // mindestens eine Art
                    })
                  }
                  className={
                    "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors " +
                    (active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40")
                  }
                >
                  {v === "minijob" ? "Minijob" : v === "teilzeit" ? "Teilzeit" : "Vollzeit"}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Nur die aktivierten Arten stehen Bewerbern dieses Mandanten bei der Registrierung zur Auswahl.
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
          <div>
            <Label className="text-xs">WebID-Identifikation</Label>
            <p className="text-[10px] text-muted-foreground mt-1">
              Blendet das WebID-Modul für dieses Unternehmen im Mitarbeiter- und Admin-Portal ein bzw. aus.
              Vorhandene Daten bleiben beim Ausschalten erhalten.
            </p>
          </div>
          <Switch checked={webidEnabled} onCheckedChange={setWebidEnabled} />
        </div>

        {tenant && (
          <div className="space-y-2 pt-2">
            <Label className="text-xs flex items-center gap-1.5">
              <PenTool className="h-3.5 w-3.5" />
              Vertragsunterschrift
            </Label>
            <p className="text-[10px] text-muted-foreground">
              Generiere eine digitale Unterschrift für alle Verträge dieses Tenants. Wähle eine Schriftart aus.
            </p>
            <SignatureGenerator
              tenantId={tenant.id}
              currentUrl={(tenant as any)?.company_signature_url}
            />
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Teamleiter-Profil</p>
        <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border">
          <div className="relative">
            {leaderAvatarUrl ? (
              <img src={leaderAvatarUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
            ) : (
              <div className="h-11 w-11 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <span className="text-xs font-bold text-primary">{leaderInitials}</span>
              </div>
            )}
            {leaderOnline && (
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-accent border-2 border-card" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{leaderName || "Teamleiter"}</p>
            <p className="text-xs text-muted-foreground">{leaderTitle || "Dein Ansprechpartner"}</p>
            <p className="text-[10px] text-accent">{leaderOnline ? "Online" : leaderResponseTime}</p>
          </div>
          <div className="flex flex-col gap-1">
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.currentTarget.value = "";
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) { toast({ title: "Datei zu groß", description: "Max. 5 MB.", variant: "destructive" }); return; }
                setUploadingAvatar(true);
                try {
                  const compressed = await compressImage(file, { maxDim: 512, quality: 0.9 });
                  const ext = compressed.name.split(".").pop() || "jpg";
                  const path = `${tenant?.id ?? "new"}/${Date.now()}.${ext}`;
                  const { error } = await supabase.storage.from("team-leader-avatars").upload(path, compressed, { cacheControl: "3600", upsert: true, contentType: compressed.type });
                  if (error) throw error;
                  const { data: pub } = supabase.storage.from("team-leader-avatars").getPublicUrl(path);
                  setLeaderAvatarUrl(pub.publicUrl);
                  toast({ title: "Bild hochgeladen", description: "Vergiss nicht zu speichern." });
                } catch (err: any) {
                  toast({ title: "Upload fehlgeschlagen", description: err.message, variant: "destructive" });
                } finally {
                  setUploadingAvatar(false);
                }
              }}
            />
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={uploadingAvatar} onClick={() => avatarInputRef.current?.click()}>
              {uploadingAvatar ? <Loader2 className="h-3 w-3 animate-spin" /> : <><User className="h-3 w-3 mr-1" /> Bild</>}
            </Button>
            {leaderAvatarUrl && (
              <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] text-destructive" onClick={() => setLeaderAvatarUrl(null)}>
                Entfernen
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Anzeigename</Label>
            <Input value={leaderName} onChange={(e) => setLeaderName(e.target.value)} placeholder="z.B. Simone Regen" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Titel / Rolle</Label>
            <Input value={leaderTitle} onChange={(e) => setLeaderTitle(e.target.value)} placeholder="Dein Ansprechpartner" className="mt-1" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Antwortzeit-Text</Label>
          <Input value={leaderResponseTime} onChange={(e) => setLeaderResponseTime(e.target.value)} placeholder="Antwortet in wenigen Minuten" className="mt-1" />
        </div>
        <div className="flex items-center justify-between py-1">
          <div>
            <Label className="text-xs">Online-Status</Label>
            <p className="text-[10px] text-muted-foreground">Grüner Punkt für Mitarbeiter sichtbar</p>
          </div>
          <Switch checked={leaderOnline} onCheckedChange={setLeaderOnline} />
        </div>
        <div>
          <Label className="text-xs">WhatsApp-Nummer (Fallback)</Label>
          <Input value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} placeholder="491234567890" className="mt-1" />
          <p className="text-[10px] text-muted-foreground mt-1">Wird angezeigt, wenn der Teamleiter offline ist</p>
        </div>
      </div>


      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Speichern…" : tenant ? "Aktualisieren" : "Hinzufügen"}
      </Button>
    </form>
  );
}

function DomainSwitchWizard({ tenant, onDone }: { tenant: Tenant; onDone: () => void }) {
  const switchFn = useServerFn(switchToNewPrimaryDomain);
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [newDomain, setNewDomain] = useState("");
  const [busy, setBusy] = useState(false);

  const currentPrimary = ((tenant as any).primary_domain ?? tenant.domain ?? "").toLowerCase();
  const aliases: string[] = Array.isArray((tenant as any).domain_aliases) ? (tenant as any).domain_aliases : [];
  const normalized = newDomain.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const valid = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized) && normalized !== currentPrimary;

  const futureAliases = Array.from(new Set([...aliases.map((s) => s.toLowerCase()), currentPrimary].filter((a) => a && a !== normalized)));

  const handleSubmit = async () => {
    setBusy(true);
    try {
      const res = await switchFn({ data: { tenant_id: tenant.id, new_domain: normalized } });
      toast({ title: "Domain gewechselt", description: `Aktive Versand-Domain ist jetzt ${res.primary_domain}.` });
      onDone();
    } catch (err: any) {
      toast({ title: "Fehler", description: err?.message ?? "Wechsel fehlgeschlagen", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={step >= 1 ? "font-semibold text-foreground" : ""}>1. Neue Domain</span>
        <span>→</span>
        <span className={step >= 2 ? "font-semibold text-foreground" : ""}>2. Bestätigung</span>
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
            <p><span className="font-semibold">Aktuelle Primary:</span> <code className="font-mono">{currentPrimary || "—"}</code></p>
            <p><span className="font-semibold">Bestehende Aliase:</span> <code className="font-mono">{aliases.join(", ") || "—"}</code></p>
          </div>
          <div>
            <Label className="text-xs">Neue Domain (Primary)</Label>
            <Input
              autoFocus
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="digital-dgigmbh.com"
              className="mt-1 font-mono"
            />
            {newDomain && !valid && (
              <p className="text-[11px] text-destructive mt-1">
                {normalized === currentPrimary ? "Bereits aktive Primary." : "Ungültiges Domain-Format."}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" disabled={!valid} onClick={() => setStep(2)}>Weiter →</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="rounded-md border border-border p-3 space-y-2 text-xs">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Neue Primary-Domain</p>
                <code className="font-mono text-foreground">{normalized}</code>
                <p className="text-muted-foreground mt-1">Neue Mails (Login, Reminder, Onboarding) gehen ab sofort von dieser Domain raus.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 pt-2 border-t border-border">
              <ArrowRightLeft className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Aliase nach Wechsel</p>
                <code className="font-mono text-foreground">{futureAliases.join(", ") || "—"}</code>
                <p className="text-muted-foreground mt-1">Bewerber, die alte Links/Mails aufrufen, landen weiterhin im richtigen Tenant.</p>
              </div>
            </div>
          </div>
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-3 text-[11px] text-amber-900 dark:text-amber-100">
            <p className="font-semibold mb-1">⚠ Wichtig vor dem Wechsel</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>SMTP-Absender (<code>sender_email</code>) muss zur neuen Domain passen (sonst Spam-Risiko).</li>
              <li>DNS (SPF/DKIM/DMARC) für <code>{normalized}</code> muss eingerichtet sein.</li>
              <li>Im Anschluss kannst du auf <code>/admin/recovery</code> die Bewerber/Mitarbeiter über den Wechsel informieren.</li>
            </ul>
          </div>
          <div className="flex justify-between gap-2 pt-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStep(1)}>← Zurück</Button>
            <Button size="sm" disabled={busy} onClick={handleSubmit} className="gap-2">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Wechsel durchführen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminTenantsPage() {

  const { tenants, loading, reload } = useAllTenants();
  const [editTenant, setEditTenant] = useState<Tenant | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [switchTenant, setSwitchTenant] = useState<Tenant | undefined>();
  const { toast } = useToast();
  const setDnsFn = useServerFn(setLandingDnsRecord);
  const { data: readiness, loading: readinessLoading, reload: reloadReadiness } = useTenantReadiness();
  const [readinessTenantId, setReadinessTenantId] = useState<string | null>(null);

  const setupDns = async (t: Tenant) => {
    const { data: fastRows } = await supabase
      .from("landing_pages")
      .select("id")
      .eq("tenant_id", t.id)
      .eq("flow_type", "fast")
      .limit(1);
    if (!fastRows || !fastRows.length) {
      toast({
        title: "portal.<domain> nicht nötig",
        description: "Tenant hat keine Fasttrack-Landing — Subdomain wird nur für Fasttrack angelegt.",
      });
      return;
    }
    const primary = ((t as any).primary_domain ?? t.domain ?? "").toLowerCase();
    const aliases: string[] = Array.isArray((t as any).domain_aliases) ? (t as any).domain_aliases : [];
    const hosts = Array.from(new Set([primary, ...aliases].filter(Boolean))).map((d) => `portal.${d}`);
    for (const host of hosts) {
      try {
        await setDnsFn({ data: { domain: host, ip: PORTAL_SERVER_IP, proxied: true } });
        toast({ title: "DNS gesetzt", description: `${host} → ${PORTAL_SERVER_IP}` });
      } catch (err: any) {
        toast({
          title: "DNS fehlgeschlagen",
          description: `${host}: ${err?.message ?? "Zone erst syncen"}`,
          variant: "destructive",
        });
      }
    }
  };



  const toggleActive = async (t: Tenant) => {
    await supabase.from("tenants").update({ is_active: !t.is_active }).eq("id", t.id);
    reload();
  };

  const resumeEmails = async (t: Tenant) => {
    const { error } = await supabase.from("tenants").update({
      emails_paused: false,
      emails_paused_at: null,
      emails_paused_reason: null,
      emails_paused_by: null,
    }).eq("id", t.id);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    // Counter zurücksetzen
    await supabase.from("tenant_smtp_health" as any).upsert({
      tenant_id: t.id, consecutive_fails: 0, last_verify_ok: null, updated_at: new Date().toISOString(),
    });
    toast({ title: "Versand fortgesetzt", description: `Mail-Versand für ${t.name} ist wieder aktiv.` });
    reload();
  };

  const pauseEmails = async (t: Tenant) => {
    const reason = window.prompt(`Mail-Versand für "${t.name}" pausieren.\nGrund (optional):`, "Manuell pausiert");
    if (reason === null) return; // Abbruch
    const { error } = await supabase.from("tenants").update({
      emails_paused: true,
      emails_paused_at: new Date().toISOString(),
      emails_paused_reason: reason || "Manuell pausiert",
      emails_paused_by: "manual:admin",
    }).eq("id", t.id);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Versand pausiert", description: `Für ${t.name} werden keine Mails mehr versendet.` });
    reload();
  };

  // Ein Mandant hängt an Bewerbungen, Mitarbeitern, Verträgen usw.
  // Statt eines rohen Datenbankfehlers zeigen wir vorher im Klartext,
  // was noch verknüpft ist – gelöscht wird nur, wenn nichts mehr dranhängt.
  const deleteTenant = async (id: string) => {
    const tenant = tenants.find((t) => t.id === id);
    const checks: Array<{ table: string; label: string }> = [
      { table: "applications", label: "Bewerbungen" },
      { table: "profiles", label: "Mitarbeiter" },
      { table: "contracts", label: "unterschriebene Verträge" },
      { table: "contract_templates", label: "Vertragsvorlagen" },
      { table: "documents", label: "Dokumente" },
    ];
    const blocking: string[] = [];
    for (const c of checks) {
      const { count } = await (supabase as any)
        .from(c.table)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", id);
      if (count && count > 0) blocking.push(`${count} ${c.label}`);
    }

    if (blocking.length > 0) {
      toast({
        title: "Mandant kann nicht gelöscht werden",
        description:
          `${tenant?.name ?? "Dieser Mandant"} ist noch verknüpft mit: ${blocking.join(", ")}. ` +
          `Diese Daten müssten zuerst entfernt oder einem anderen Mandanten zugeordnet werden. ` +
          `Empfehlung: stattdessen „Deaktivieren“ – dann läuft nichts mehr, die Historie bleibt aber erhalten.`,
        variant: "destructive",
      });
      return;
    }

    if (!window.confirm(`${tenant?.name ?? "Mandant"} endgültig löschen?`)) return;

    const { error } = await supabase.from("tenants").delete().eq("id", id);
    if (error) {
      toast({
        title: "Fehler beim Löschen",
        description: error.message.includes("foreign key")
          ? "Es hängen noch Daten an diesem Mandanten. Bitte stattdessen deaktivieren."
          : error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Mandant gelöscht" });
    reload();
  };

  if (loading) return <div className="p-5 space-y-4"><PageHeaderSkeleton /><TableSkeleton rows={3} cols={4} /></div>;

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-heading font-bold text-foreground">Domains / Tenants</h1>
          <p className="text-xs text-muted-foreground">{tenants.length} Domains verwaltet</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditTenant(undefined); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="h-3.5 w-3.5" /> Domain hinzufügen</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editTenant ? "Domain bearbeiten" : "Neue Domain"}</DialogTitle>
            </DialogHeader>
            <TenantForm tenant={editTenant} onSaved={() => { setDialogOpen(false); setEditTenant(undefined); reload(); }} />
          </DialogContent>
        </Dialog>
      </div>

      {tenants.length === 0 ? (
        <EmptyState icon={Globe} title="Keine Domains" description="Füge deine erste Domain hinzu, um Landing Pages zu verwalten." actionLabel="Domain hinzufügen" onAction={() => setDialogOpen(true)} />
      ) : (
        <div className="grid gap-3">
          {tenants.map((t) => (
            <Card key={t.id}>
              <CardContent className="py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: t.primary_color + "20" }}>
                    <Globe className="h-5 w-5" style={{ color: t.primary_color ?? undefined }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.domain}</p>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(t.id); toast({ title: "Tenant-ID kopiert", description: t.id }); }}
                      className="mt-1 text-[10px] font-mono text-muted-foreground/80 hover:text-foreground underline decoration-dotted"
                      title="Klicken zum Kopieren"
                    >
                      UUID: {t.id}
                    </button>
                  </div>
                  <Badge variant={t.is_active ? "default" : "secondary"} className="text-[10px]">
                    {t.is_active ? "Aktiv" : "Inaktiv"}
                  </Badge>
                  <TenantReadinessBadge
                    readiness={readiness[t.id]}
                    loading={readinessLoading}
                    onOpen={() => setReadinessTenantId(t.id)}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="relative">
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="h-3.5 w-3.5 text-primary" />
                      </div>
                      {t.team_leader_online && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-accent border border-card" />
                      )}
                    </div>
                    <span className="truncate max-w-[120px]">{t.team_leader_name}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(t)} className="text-xs">
                      {t.is_active ? "Deaktivieren" : "Aktivieren"}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Domain wechseln (Wizard)" onClick={() => setSwitchTenant(t)}>
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="portal.<domain>+Aliases DNS anlegen/aktualisieren" onClick={() => setupDns(t)}>
                      <Globe className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditTenant(t); setDialogOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>

                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteTenant(t.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!switchTenant} onOpenChange={(v) => { if (!v) setSwitchTenant(undefined); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Domain-Wechsel · {switchTenant?.name}</DialogTitle>
          </DialogHeader>
          {switchTenant && (
            <DomainSwitchWizard
              tenant={switchTenant}
              onDone={() => { setSwitchTenant(undefined); reload(); }}
            />
          )}
        </DialogContent>
      </Dialog>

      <TenantReadinessDialog
        readiness={readinessTenantId ? readiness[readinessTenantId] : undefined}
        open={!!readinessTenantId}
        onOpenChange={(v) => { if (!v) setReadinessTenantId(null); }}
        onRefresh={reloadReadiness}
      />
    </div>
  );
}

