import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { MessageCircle, Save } from "lucide-react";
import { buildWhatsAppHref, resetWhatsAppSupportCache } from "@/hooks/use-whatsapp-support";

/**
 * Globale WhatsApp-Support-Nummer (ein Button für Bewerbung, Registrierung
 * und Mitarbeiterportal).
 */
export function WhatsAppSupportCard() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase.from("system_settings") as any)
        .select("whatsapp_number, whatsapp_enabled")
        .eq("id", 1)
        .maybeSingle();
      setEnabled(!!data?.whatsapp_enabled);
      setValue(data?.whatsapp_number ?? "");
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await (supabase.from("system_settings") as any)
      .upsert({ id: 1, whatsapp_number: value.trim() || null, whatsapp_enabled: enabled }, { onConflict: "id" });
    setSaving(false);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    resetWhatsAppSupportCache();
    toast({ title: "WhatsApp-Support gespeichert" });
  };

  const preview = buildWhatsAppHref(value);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageCircle className="h-4 w-4" /> WhatsApp-Support
        </CardTitle>
        <CardDescription>
          Button „Probleme, Fragen?" unten links — sichtbar auf der Bewerbungsseite, im
          Bewerbungsgespräch, bei der Registrierung und im Mitarbeiterportal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-md">
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium">WhatsApp-Button anzeigen</p>
            <p className="text-xs text-muted-foreground">Ein-/ausblenden für alle Seiten.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={loading} />
        </div>
        <div className="space-y-2">
          <Label>WhatsApp-Nummer oder Link</Label>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="+49 151 12345678 oder https://wa.me/49151..."
            disabled={loading}
          />
          {preview && (
            <p className="text-xs text-muted-foreground break-all">
              Link: <a href={preview} target="_blank" rel="noopener noreferrer" className="text-primary underline">{preview}</a>
            </p>
          )}
          {enabled && !preview && (
            <p className="text-xs text-destructive">Bitte eine gültige Nummer oder URL hinterlegen.</p>
          )}
        </div>
        <Button onClick={save} disabled={saving || loading} className="w-full gap-2">
          <Save className="h-4 w-4" />
          {saving ? "Speichern…" : "Speichern"}
        </Button>
      </CardContent>
    </Card>
  );
}
