import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/settings")({
  component: AdminSettingsPage,
});

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { translateAuthError } from "@/lib/auth-errors";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Lock, Save, Palette, Bot, ArrowRight, Globe, Users as UsersIcon, Mail, History, Handshake, CalendarClock, Server, FileText, AlertTriangle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookingLimitsCard } from "@/components/admin/BookingLimitsCard";
import { StandardTasksCard } from "@/components/admin/StandardTasksCard";
import { StaffAccountsCard } from "@/components/admin/StaffAccountsCard";
import { Link } from "@tanstack/react-router";

function AdminSettingsPage() {
  const { toast } = useToast();
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);

  const changePassword = async () => {
    if (newPw.length < 6) {
      toast({ title: "Fehler", description: "Mindestens 6 Zeichen.", variant: "destructive" });
      return;
    }
    if (newPw !== confirmPw) {
      toast({ title: "Fehler", description: "Passwörter stimmen nicht überein.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) {
      toast({ title: "Fehler", description: translateAuthError(error.message), variant: "destructive" });
    } else {
      toast({ title: "Passwort geändert" });
      setNewPw("");
      setConfirmPw("");
    }
    setSaving(false);
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-heading font-bold text-foreground">Einstellungen</h1>
        <p className="text-sm text-muted-foreground mt-1">Nach Themen sortiert — wähle oben einen Bereich.</p>
      </div>

      <Tabs defaultValue="marke">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="marke">Marke &amp; Domains</TabsTrigger>
          <TabsTrigger value="bewerbung">Bewerbung</TabsTrigger>
          <TabsTrigger value="auftraege">Aufträge</TabsTrigger>
          <TabsTrigger value="konto">Konto &amp; Team</TabsTrigger>
        </TabsList>

        {SECTIONS.map((section) => (
          <TabsContent key={section.value} value={section.value} className="mt-5 space-y-5">
            <p className="text-xs text-muted-foreground">{section.hint}</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {section.tiles.map((tile) => (
                <Tile key={tile.to} {...tile} />
              ))}
            </div>
            {section.value === "bewerbung" && <BookingLimitsCard />}
            {section.value === "auftraege" && <StandardTasksCard />}
            {section.value === "konto" && (
              <>
                <StaffAccountsCard />
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Palette className="h-4 w-4" /> Erscheinungsbild
                    </CardTitle>
                    <CardDescription>Wähle zwischen hellem und dunklem Modus.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ThemeToggle variant="outline" />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Lock className="h-4 w-4" /> Passwort ändern
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 max-w-md">
                    <div className="space-y-2">
                      <Label>Neues Passwort</Label>
                      <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Mindestens 6 Zeichen" />
                    </div>
                    <div className="space-y-2">
                      <Label>Passwort bestätigen</Label>
                      <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Nochmal eingeben" />
                    </div>
                    <Button onClick={changePassword} disabled={saving || !newPw} className="w-full gap-2">
                      <Save className="h-4 w-4" />
                      {saving ? "Speichern…" : "Passwort ändern"}
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <p className="text-xs text-muted-foreground">
        SMS-API-Keys werden im Bereich <strong>SMS</strong> verwaltet.
      </p>
    </div>
  );
}

type TileDef = { to: string; title: string; desc: string; icon: any };

function Tile({ to, title, desc, icon: Icon }: TileDef) {
  return (
    <Link to={to} className="group">
      <Card className="hover:border-primary/40 transition-colors h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Icon className="h-4 w-4" /> {title}</CardTitle>
          <CardDescription className="text-xs">{desc}</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <span className="text-xs text-primary inline-flex items-center gap-1">
            Öffnen <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

const SECTIONS: { value: string; hint: string; tiles: TileDef[] }[] = [
  {
    value: "marke",
    hint: "Alles rund um Auftritt, Domains und Server.",
    tiles: [
      { to: "/admin/tenants", title: "Domains / Tenants", desc: "Rebranding, Hero, Logo, Unternehmensdaten", icon: Globe },
      { to: "/admin/landing-generator", title: "Landing Pages", desc: "Themes, WhatsApp-Button, Generator", icon: Globe },
      { to: "/admin/domains", title: "Domains (Cloudflare)", desc: "DNS, SSL, Health-Checks", icon: Globe },
      { to: "/admin/infrastructure", title: "Infrastruktur", desc: "Landing-Server, Heartbeat, Deploys", icon: Server },
    ],
  },
  {
    value: "bewerbung",
    hint: "Bewerbungsstrecke: Termine, KI-Interview, Partner.",
    tiles: [
      
      { to: "/admin/calendly", title: "Calendly", desc: "Webhooks, Event-Types, Signing-Keys", icon: CalendarClock },
      { to: "/admin/ai-settings", title: "KI-Assistent", desc: "An/Aus, FAQ, System-Prompt, Modell", icon: Bot },
      { to: "/admin/vermittlung", title: "Vermittlung", desc: "Broker-Flow, Übergabe an Fast-Track", icon: Handshake },
      { to: "/admin/partner-companies", title: "Fast-Track-Firmen", desc: "Partner-Unternehmen verwalten", icon: Handshake },
    ],
  },
  {
    value: "auftraege",
    hint: "Standard-Aufträge und Vertragsvorlagen.",
    tiles: [
      { to: "/admin/contracts", title: "Verträge", desc: "Vertragsvorlagen anlegen und bearbeiten", icon: FileText },
      { to: "/admin/tasks", title: "Auftrags-Vorlagen", desc: "Aufgaben und Schritte pflegen", icon: FileText },
      { to: "/admin/bots", title: "Automatisierung / Bots", desc: "Registrierungs-Bots, Läufe und Admin-Übergaben", icon: Bot },
    ],
  },
  {
    value: "konto",
    hint: "Eigenes Konto, Team und Protokoll.",
    tiles: [
      { to: "/admin/team-leader-settings", title: "Teamleiter", desc: "Profil, Avatar, Online-Status", icon: UsersIcon },
      { to: "/admin/activity", title: "Protokoll", desc: "Aktivitäts-Log aller Admin-Aktionen", icon: History },
    ],
  },
];
