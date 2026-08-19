import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { UserCog, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  listStaffAccounts,
  createStaffAccount,
  revokeStaffAccount,
  setStaffTenants,
} from "@/lib/staff-accounts.functions";

type StaffAccount = { user_id: string; email: string; full_name: string; tenant_ids: string[] };
type Tenant = { id: string; name: string };

export function StaffAccountsCard() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await listStaffAccounts();
      setAccounts(res.accounts);
      setTenants(res.tenants ?? []);
    } catch (e: any) {
      toast({ title: "Fehler", description: e?.message ?? "Konten konnten nicht geladen werden.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    setSaving(true);
    try {
      await createStaffAccount({ data: { full_name: fullName.trim(), email: email.trim(), password } });
      toast({ title: "Konto angelegt", description: `${email.trim()} kann sich jetzt anmelden.` });
      setFullName("");
      setEmail("");
      setPassword("");
      await load();
    } catch (e: any) {
      toast({ title: "Fehler", description: e?.message ?? "Konto konnte nicht angelegt werden.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (acc: StaffAccount) => {
    if (!window.confirm(`Admin-Rechte für ${acc.email || acc.full_name} entziehen?`)) return;
    try {
      await revokeStaffAccount({ data: { user_id: acc.user_id } });
      toast({ title: "Rechte entzogen" });
      await load();
    } catch (e: any) {
      toast({ title: "Fehler", description: e?.message ?? "Konnte nicht entzogen werden.", variant: "destructive" });
    }
  };

  const toggleTenant = async (acc: StaffAccount, tenantId: string) => {
    const next = acc.tenant_ids.includes(tenantId)
      ? acc.tenant_ids.filter((t) => t !== tenantId)
      : [...acc.tenant_ids, tenantId];
    setAccounts((prev) => prev.map((a) => (a.user_id === acc.user_id ? { ...a, tenant_ids: next } : a)));
    try {
      await setStaffTenants({ data: { user_id: acc.user_id, tenant_ids: next } });
    } catch (e: any) {
      toast({ title: "Fehler", description: e?.message ?? "Konnte nicht gespeichert werden.", variant: "destructive" });
      await load();
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <UserCog className="h-4 w-4" /> Admin-Mitarbeiter
        </CardTitle>
        <CardDescription>
          Zusatzkonto mit Zugriff auf Aufträge (zuweisen, prüfen) und alle Chats.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">Wird geladen…</p>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Admin-Mitarbeiter angelegt.</p>
          ) : (
            accounts.map((acc) => (
              <div key={acc.user_id} className="rounded-lg border border-border px-3 py-2 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{acc.full_name || "Ohne Namen"}</p>
                    <p className="text-xs text-muted-foreground truncate">{acc.email}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => revoke(acc)} className="gap-1.5 shrink-0">
                    <Trash2 className="h-3.5 w-3.5" /> Entziehen
                  </Button>
                </div>
                <div className="pt-1 border-t border-border/60">
                  <p className="text-[11px] text-muted-foreground mb-1.5">
                    Sichtbare Marken (Chats) — nichts angehakt = alle
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {tenants.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 text-xs cursor-pointer">
                        <Checkbox
                          checked={acc.tenant_ids.includes(t.id)}
                          onCheckedChange={() => void toggleTenant(acc, t.id)}
                        />
                        <span className="truncate max-w-[180px]">{t.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

      </CardContent>
    </Card>
  );
}
