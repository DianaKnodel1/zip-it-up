// Proxy-Pool: Import aus dem Anbieter-Dashboard, Aktivieren, Löschen.
// Passwörter werden nie zurückgegeben, nur serverseitig genutzt.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Trash2 } from "lucide-react";
import { deleteBotProxy, importBotProxies, listBotProxies, setBotProxyActive } from "@/lib/bots.functions";

export function BotProxyPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const list = useServerFn(listBotProxies);
  const importFn = useServerFn(importBotProxies);
  const setActive = useServerFn(setBotProxyActive);
  const remove = useServerFn(deleteBotProxy);

  const [raw, setRaw] = useState("");
  const [provider, setProvider] = useState("nsocks");
  const [kind, setKind] = useState<"http" | "socks5">("http");

  const { data } = useQuery({ queryKey: ["bot-proxies"], queryFn: () => list() });
  const rows = data?.rows ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["bot-proxies"] });

  const importMut = useMutation({
    mutationFn: () => importFn({ data: { raw, provider, kind, country: "DE" } }),
    onSuccess: (res) => {
      setRaw("");
      invalidate();
      toast({ title: `${res.imported} Proxys importiert`, description: res.skipped ? `${res.skipped} Zeilen übersprungen` : undefined });
    },
    onError: (e: any) => toast({ title: "Import fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Eine Zeile je Eintrag: <code>ip:port:benutzer:passwort</code>. Empfohlen ist der HTTP-Zugang mit
          Benutzer und Passwort. SOCKS5 funktioniert nur mit IP-Freigabe beim Anbieter, weil der Browser
          dort keine Anmeldung unterstützt.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Anbieter</Label>
            <Input value={provider} onChange={(e) => setProvider(e.target.value)} className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Typ</Label>
            <div className="flex gap-2 mt-1">
              <Button size="sm" variant={kind === "http" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setKind("http")}>HTTP</Button>
              <Button size="sm" variant={kind === "socks5" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setKind("socks5")}>SOCKS5</Button>
            </div>
          </div>
        </div>
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={5}
          placeholder={"1.2.3.4:8000:benutzer:passwort\n1.2.3.5:8000:benutzer:passwort"}
          className="text-sm font-mono"
        />
        <Button size="sm" disabled={!raw.trim() || importMut.isPending} onClick={() => importMut.mutate()}>
          Importieren
        </Button>
      </div>

      <div className="rounded-lg border divide-y">
        {rows.length === 0 && <p className="p-4 text-xs text-muted-foreground">Noch keine Proxys hinterlegt.</p>}
        {rows.map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
            <Badge variant="secondary" className="text-[10px] uppercase">{p.kind}</Badge>
            <span className="font-mono text-xs">{p.host}:{p.port}</span>
            <span className="text-xs text-muted-foreground">{p.provider}{p.country ? ` · ${p.country}` : ""}</span>
            <span className="text-xs text-muted-foreground ml-auto">{p.use_count}× genutzt</span>
            <Switch
              checked={p.is_active}
              onCheckedChange={async (v) => { await setActive({ data: { id: p.id, is_active: v } }); invalidate(); }}
            />
            <Button
              size="icon" variant="ghost" className="h-7 w-7"
              onClick={async () => { await remove({ data: { id: p.id } }); invalidate(); }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
