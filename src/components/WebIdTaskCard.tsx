import { useNavigate } from "@/lib/router-compat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { WEBID_STATUS_LABEL, type WebIdStatus } from "@/lib/webid";
import { Copy, ShieldCheck, PlayCircle, CheckCircle2 } from "lucide-react";

export type { WebIdStatus };

export interface WebIdAssignment {
  webid_client_name: string | null;
  webid_status: WebIdStatus | null;
  individual_case_number: string | null;
  individual_email: string | null;
  individual_password: string | null;
}

export function WebIdTaskCard({
  assignmentId,
  data,
}: {
  assignmentId: string;
  data: WebIdAssignment;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();

  if (!data.individual_case_number && !data.webid_client_name) return null;

  const copy = (val: string, label: string) => {
    navigator.clipboard.writeText(val);
    toast({ title: `${label} kopiert` });
  };

  const status: WebIdStatus = (data.webid_status as WebIdStatus) ?? "offen";
  const badge = WEBID_STATUS_LABEL[status] ?? WEBID_STATUS_LABEL.offen;
  const done = status === "bestaetigt" || status === "geprueft";

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm flex items-center gap-2 text-primary">
            <ShieldCheck className="h-4 w-4" /> WebID-Identifikation
            {data.webid_client_name && <span className="text-foreground">· {data.webid_client_name}</span>}
          </CardTitle>
          <Badge className={badge.className}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Die Identifikation kannst du direkt hier im Portal durchführen. Es öffnet sich dabei die
          offizielle WebID-Oberfläche — WebID führt die Prüfung durch, das Portal begleitet dich nur.
        </p>

        {data.individual_case_number && (
          <div className="rounded-xl border border-border bg-background p-4 text-center space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Vorgangsnummer</p>
            <p className="text-2xl font-mono font-bold tracking-widest break-all">{data.individual_case_number}</p>
            <Button size="sm" variant="outline" onClick={() => copy(data.individual_case_number!, "Vorgangsnummer")}>
              <Copy className="h-3.5 w-3.5 mr-1" /> Kopieren
            </Button>
          </div>
        )}

        {(data.individual_email || data.individual_password) && (
          <div className="space-y-2">
            {data.individual_email && (
              <CredRow label="E-Mail" value={data.individual_email} onCopy={copy} />
            )}
            {data.individual_password && (
              <CredRow label="Passwort" value={data.individual_password} onCopy={copy} />
            )}
          </div>
        )}

        <Button size="lg" className="w-full" onClick={() => navigate(`/tasks/${assignmentId}/webid`)}>
          {done
            ? <><CheckCircle2 className="h-4 w-4 mr-1.5" /> WebID-Station öffnen</>
            : <><PlayCircle className="h-4 w-4 mr-1.5" /> Identifikation im Portal starten</>}
        </Button>
      </CardContent>
    </Card>
  );
}

function CredRow({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string, l: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-background border border-border p-3">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className="text-sm font-mono truncate">{value}</p>
      </div>
      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0" onClick={() => onCopy(value, label)}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}