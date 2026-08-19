import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { RefreshCcw, ShieldCheck, Loader2, Info, Ban } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  listSuppressedRecipients,
  unsuppressRecipient,
  blockRecipient,
  type SuppressedRecipient,
} from "@/lib/suppressed-recipients.functions";

export function SuppressedRecipientsPanel() {
  const { toast } = useToast();
  const list = useServerFn(listSuppressedRecipients);
  const unsuppress = useServerFn(unsuppressRecipient);
  const block = useServerFn(blockRecipient);
  const [rows, setRows] = useState<SuppressedRecipient[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newReason, setNewReason] = useState("");
  const [blocking, setBlocking] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await list({ data: {} as any });
      setRows(res.rows);
    } catch (e: any) {
      toast({ title: "Laden fehlgeschlagen", description: e?.message ?? String(e), variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const handleUnsuppress = async (email: string, tenantId: string) => {
    const rowKey = `${email}:${tenantId}`;
    setBusy(rowKey);
    try {
      await unsuppress({ data: { recipient_email: email, tenant_id: tenantId } });
      toast({ title: "Sperre aufgehoben", description: email });
      await load();
    } catch (e: any) {
      toast({ title: "Fehler", description: e?.message ?? String(e), variant: "destructive" });
    } finally { setBusy(null); }
  };

  const handleBlock = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      toast({ title: "Ungültige E-Mail", variant: "destructive" });
      return;
    }
    setBlocking(true);
    try {
      await block({ data: { recipient_email: email, reason: newReason.trim() || undefined } });
      toast({ title: "Adresse gesperrt", description: `${email} kann sich nicht mehr registrieren und erhält keine Mails.` });
      setNewEmail(""); setNewReason("");
      await load();
    } catch (e: any) {
      toast({ title: "Fehler", description: e?.message ?? String(e), variant: "destructive" });
    } finally { setBlocking(false); }
  };


  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">Gesperrte Empfänger</h3>
          <p className="text-xs text-muted-foreground max-w-xl mt-1">
            E-Mail-Adressen, die 3× in Folge nicht zustellbar waren, werden hier automatisch gesperrt.
            Andere Bewerber laufen normal weiter — nur diese eine Adresse ist blockiert.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
          Neu laden
        </Button>
      </div>

      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>Tenant-weite Auto-Pausen sind deaktiviert. Ein einzelner SMTP-Hänger blockiert nie mehr alle Bewerber.</span>
      </div>

      <div className="rounded-xl border p-3 space-y-2 bg-card">
        <div className="flex items-center gap-2">
          <Ban className="h-4 w-4 text-destructive" />
          <h4 className="text-sm font-semibold">Adresse manuell sperren</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Blockiert alle künftigen Mails an diese Adresse <strong>und</strong> verhindert eine
          Neu-Registrierung. Falls bereits ein Account existiert, wird der Login deaktiviert.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Input
            type="email" placeholder="max@example.com"
            value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
            className="flex-1 min-w-[220px] h-9 text-xs"
            disabled={blocking}
          />
          <Input
            type="text" placeholder="Grund (optional)"
            value={newReason} onChange={(e) => setNewReason(e.target.value)}
            className="flex-1 min-w-[180px] h-9 text-xs"
            disabled={blocking}
          />
          <Button
            size="sm" variant="destructive" onClick={handleBlock}
            disabled={blocking || !newEmail.trim()}
            className="h-9 gap-1.5"
          >
            {blocking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
            Sperren
          </Button>
        </div>
      </div>


      {loading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Lade…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground rounded-xl border border-dashed">
          Keine gesperrten Adressen. 
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Gesperrt seit</th>
                <th className="text-left px-3 py-2 font-medium">Adresse</th>
                <th className="text-left px-3 py-2 font-medium">Tenant</th>
                <th className="text-center px-3 py-2 font-medium">Fails</th>
                <th className="text-left px-3 py-2 font-medium">Letzter Fehler</th>
                <th className="text-right px-3 py-2 font-medium">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.recipient_email}:${r.tenant_id}`} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(r.suppressed_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-3 py-2 break-all">{r.recipient_email}</td>
                  <td className="px-3 py-2">{r.tenant_name ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant="destructive" className="text-[10px]">{r.consecutive_failures}</Badge>
                  </td>
                  <td className="px-3 py-2 text-destructive max-w-md truncate" title={r.last_error ?? ""}>
                    {(r.last_error ?? "").slice(0, 100) || "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm" variant="outline"
                      onClick={() => r.tenant_id && handleUnsuppress(r.recipient_email, r.tenant_id)}
                      disabled={!r.tenant_id || busy === `${r.recipient_email}:${r.tenant_id}`}
                      className="h-7 gap-1"
                    >
                      {busy === `${r.recipient_email}:${r.tenant_id}`
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <ShieldCheck className="h-3 w-3" />}
                      Sperre aufheben
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
