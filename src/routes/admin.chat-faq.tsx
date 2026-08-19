import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/chat-faq")({
  component: AdminChatFaqPage,
});

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Loader2 } from "lucide-react";

interface FaqRow {
  id: string;
  question: string;
  answer: string;
  is_active: boolean;
  sort_order: number;
}

function AdminChatFaqPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<FaqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("chat_faq" as any)
      .select("id, question, answer, is_active, sort_order")
      .order("sort_order", { ascending: true });
    if (error) {
      toast({ title: "FAQ konnte nicht geladen werden", description: error.message, variant: "destructive" });
    } else {
      setRows((data ?? []) as unknown as FaqRow[]);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!question.trim() || !answer.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("chat_faq" as any).insert({
      question: question.trim(),
      answer: answer.trim(),
      sort_order: rows.length,
    } as any);
    setSaving(false);
    if (error) {
      toast({ title: "Nicht gespeichert", description: error.message, variant: "destructive" });
      return;
    }
    setQuestion("");
    setAnswer("");
    void load();
  };

  const toggle = async (row: FaqRow) => {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r)));
    const { error } = await supabase.from("chat_faq" as any)
      .update({ is_active: !row.is_active } as any)
      .eq("id", row.id);
    if (error) {
      toast({ title: "Nicht gespeichert", description: error.message, variant: "destructive" });
      void load();
    }
  };

  const remove = async (row: FaqRow) => {
    const { error } = await supabase.from("chat_faq" as any).delete().eq("id", row.id);
    if (error) {
      toast({ title: "Nicht gelöscht", description: error.message, variant: "destructive" });
      return;
    }
    void load();
  };

  return (
    <div className="max-w-3xl space-y-6 p-4">
      <div>
        <h1 className="text-xl font-semibold">Chat-Wissensbasis</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Diese Antworten nutzt der Antwortvorschlag im Chat. Gesendet wird nichts automatisch –
          du prüfst jeden Vorschlag und schickst ihn selbst ab.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Neuen Eintrag anlegen</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Frage</Label>
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="z. B. Wann bekomme ich meine Vergütung?" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Antwort</Label>
            <Textarea rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Antwort, so wie du sie schreiben würdest." />
          </div>
          <Button onClick={() => void add()} disabled={saving || !question.trim() || !answer.trim()} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Hinzufügen
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Einträge ({rows.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Laden…</p>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Noch keine Einträge.</p>
          )}
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{row.question}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={row.is_active} onCheckedChange={() => void toggle(row)} />
                  <Button size="icon" variant="ghost" onClick={() => void remove(row)} title="Löschen">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.answer}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
