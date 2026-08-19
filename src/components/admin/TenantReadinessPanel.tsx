import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, RefreshCw } from "lucide-react";
import { getTenantReadiness, type TenantReadiness, type ReadinessCheck } from "@/lib/tenant-readiness.functions";

const DOT: Record<TenantReadiness["status"], string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-destructive",
};

const ORDER: Record<ReadinessCheck["severity"], number> = { block: 0, warn: 1, ok: 2 };

function CheckIcon({ severity }: { severity: ReadinessCheck["severity"] }) {
  if (severity === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />;
  if (severity === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />;
  return <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />;
}

/** Lädt die Go-Live-Prüfung für alle Mandanten einmalig (Admin-geschützt). */
export function useTenantReadiness() {
  const load = useServerFn(getTenantReadiness);
  const [data, setData] = useState<Record<string, TenantReadiness>>({});
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load({})
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, TenantReadiness> = {};
        for (const r of rows) map[r.tenant_id] = r;
        setData(map);
      })
      .catch(() => {
        if (!cancelled) setData({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, nonce]);

  return { data, loading, reload: () => setNonce((n) => n + 1) };
}

/** Dezenter Fortschrittspunkt in der Mandantenliste. */
export function TenantReadinessBadge({
  readiness,
  loading,
  onOpen,
}: {
  readiness?: TenantReadiness;
  loading?: boolean;
  onOpen: () => void;
}) {
  if (loading && !readiness) {
    return <span className="text-[10px] text-muted-foreground/60">prüfe …</span>;
  }
  if (!readiness) return null;
  const title =
    readiness.status === "green"
      ? "Startklar — alle Prüfpunkte erfüllt"
      : readiness.status === "red"
        ? `${readiness.blocking} blockierende(r) Punkt(e) vor dem Live-Gang`
        : `${readiness.warnings} offene Kleinigkeit(en)`;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[readiness.status]}`} />
      Go-Live {readiness.passed}/{readiness.total}
    </button>
  );
}

export function TenantReadinessDialog({
  readiness,
  open,
  onOpenChange,
  onRefresh,
}: {
  readiness?: TenantReadiness;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRefresh?: () => void;
}) {
  const checks = useMemo(
    () => [...(readiness?.checks ?? [])].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]),
    [readiness],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Go-Live-Checkliste · {readiness?.tenant_name ?? ""}
            {readiness && (
              <Badge variant={readiness.status === "green" ? "default" : readiness.status === "red" ? "destructive" : "secondary"} className="text-[10px]">
                {readiness.passed}/{readiness.total}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {!readiness ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-2">
            {checks.map((c) => (
              <div
                key={c.key}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  c.severity === "block" ? "border-destructive/40 bg-destructive/5" : c.severity === "warn" ? "border-amber-500/30 bg-amber-500/5" : "border-border/60"
                }`}
              >
                <CheckIcon severity={c.severity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {c.label} <span className="text-[10px] font-normal text-muted-foreground">· {c.group}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.detail}</p>
                </div>
                {c.href && c.severity !== "ok" && (
                  <Link to={c.href} onClick={() => onOpenChange(false)}>
                    <Button variant="ghost" size="sm" className="text-xs shrink-0">Öffnen</Button>
                  </Link>
                )}
              </div>
            ))}
            {onRefresh && (
              <Button variant="outline" size="sm" className="w-full gap-1 text-xs" onClick={onRefresh}>
                <RefreshCw className="h-3.5 w-3.5" /> Erneut prüfen
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}