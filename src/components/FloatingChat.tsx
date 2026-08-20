import { useState, useEffect, useRef } from "react";
import { useLocation } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useTeamLeader } from "@/hooks/use-team-leader";
import { useChatNotifications } from "@/hooks/use-chat-notifications";
import { useTenant } from "@/contexts/TenantContext";
import { MessageCircle, Send, BadgeCheck, Minus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatAttachmentButton, AttachmentPreview, type ChatAttachment } from "@/components/ChatAttachmentButton";

interface ChatMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  read: boolean;
  created_at: string;
  is_ai?: boolean;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
}

// Interne Admin-/KI-Notizen werden im Mitarbeiter-Chat ausgeblendet (clientseitig,
// damit keine normale Nachricht durch serverseitige Filter verloren geht).
function isInternalAdminNote(msg: ChatMessage) {
  const m = msg.message ?? "";
  return m.includes("[ESCALATE]") || m.includes("🤖 KI-Eskalation") || m.includes("🤖 KI Eskalation");
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function ChatButton({ onClick, unread, hasNewMessage }: { onClick: () => void; unread: number; hasNewMessage: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "relative h-[60px] w-[60px] rounded-full bg-primary flex items-center justify-center transition-all duration-300",
            "hover:scale-110 active:scale-95 shadow-lg shadow-primary/25",
            unread > 0 && "animate-chat-glow",
            hasNewMessage && "animate-chat-bounce"
          )}
        >
          <MessageCircle className="h-6 w-6 text-primary-foreground relative" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 h-5 min-w-[20px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1.5 shadow-sm">
              {unread}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="text-xs font-medium">
        Chat öffnen
      </TooltipContent>
    </Tooltip>
  );
}

export default function FloatingChat() {
  const { user } = useAuth();
  const location = useLocation();
  const { toast } = useToast();
  const { leader, teamLeaderId, initials: leaderInitials, statusText } = useTeamLeader();
  const { tenant } = useTenant();
  
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [humanMessages, setHumanMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [leaderTyping, setLeaderTyping] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  // Fallback-Empfänger: letzter Absender, der mir geschrieben hat (falls kein
  // team_leader_id im Profil hinterlegt ist).
  const [fallbackPartnerId, setFallbackPartnerId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const isOnChatPage = location.pathname.includes("/chat");
  const recipientId = teamLeaderId ?? fallbackPartnerId;

  const { trigger: triggerNotification } = useChatNotifications({ unread, enabled: true });

  useEffect(() => {
    if (!user || isOnChatPage) return;
    const check = async () => {
      const { count } = await supabase
        .from("chat_messages")
        .select("*", { count: "exact", head: true })
        .eq("receiver_id", user.id)
        .eq("read", false);
      setUnread(count || 0);
      setLoaded(true);
    };
    check();
  }, [user, isOnChatPage]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("floating-chat-main")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const msg = payload.new as ChatMessage;
        const isFromMe = msg.sender_id === user.id;
        const isForMe = msg.receiver_id === user.id;

        if (!isFromMe && !isForMe) return;
        if (isInternalAdminNote(msg)) return;

        // Immer in den Verlauf aufnehmen (auch wenn zu), damit nichts verloren geht.
        setHumanMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        if (isForMe && !teamLeaderId) setFallbackPartnerId(msg.sender_id);

        if (open) {
          if (isForMe) {
            supabase.from("chat_messages").update({ read: true } as any).eq("id", msg.id).then();
          }
        } else if (isForMe) {
          setUnread((u) => u + 1);
          setHasNewMessage(true);
          triggerNotification({ senderName: leader.name || "Teamleiter", body: msg.message });
        }
      })
      .on("broadcast", { event: "typing" }, (payload) => {
        if (payload.payload.userId !== user.id) {
          setLeaderTyping(true);
          setTimeout(() => setLeaderTyping(false), 3000);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, teamLeaderId, open, leader.name, triggerNotification]);

  const loadHistory = async () => {
    if (!user) return;
    setLoadError(null);
    // Kompletter Verlauf des Mitarbeiters – unabhängig davon, welche
    // Teamleiter-ID im Profil steht (ein Admin-Konto, viele Anzeigenamen).
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) {
      console.error("Chat-Verlauf konnte nicht geladen werden:", error);
      setLoadError(error.message);
      return;
    }

    const rows = ((data ?? []) as ChatMessage[]).filter((m) => !isInternalAdminNote(m));
    const lastIncoming = [...rows].reverse().find((m) => m.receiver_id === user.id);
    if (lastIncoming) setFallbackPartnerId(lastIncoming.sender_id);
    // Verlauf zusammenführen statt ersetzen – nichts geht verloren.
    setHumanMessages((prev) => {
      const map = new Map<string, ChatMessage>();
      for (const m of [...prev, ...rows]) map.set(m.id, m);
      return Array.from(map.values()).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    });
    void supabase
      .from("chat_messages")
      .update({ read: true } as any)
      .eq("receiver_id", user.id)
      .eq("read", false);
    setUnread(0);
    setHasNewMessage(false);
  };

  useEffect(() => {
    if (!open || !user) return;
    loadHistory();
  }, [open, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [humanMessages, leaderTyping]);

  const sendMessage = async () => {
    if ((!newMessage.trim() && !pendingAttachment) || !user || !recipientId) return;
    const text = newMessage.trim();
    const attachment = pendingAttachment;
    setNewMessage("");
    setPendingAttachment(null);
    setSending(true);
    try {
      const { error } = await supabase.from("chat_messages").insert({
        sender_id: user.id,
        receiver_id: recipientId,
        message: text || (attachment ? `📎 ${attachment.name}` : ""),
        attachment_url: attachment?.url ?? null,
        attachment_name: attachment?.name ?? null,
        attachment_type: attachment?.type ?? null,
      } as any);
      if (error) throw error;
    } catch (e: any) {
      toast({ title: "Fehler", description: e?.message ?? "Nachricht konnte nicht gesendet werden.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const broadcastTyping = () => {
    if (!user) return;
    supabase.channel("floating-chat-main").send({
      type: "broadcast",
      event: "typing",
      payload: { userId: user.id },
    });
  };

  if (isOnChatPage || !loaded || !recipientId) return null;

  return (
    <>
      {!open && (
        <div className="fixed bottom-6 right-6 z-50">
          <ChatButton onClick={() => setOpen(true)} unread={unread} hasNewMessage={hasNewMessage} />
        </div>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[400px] max-w-[calc(100vw-2rem)] h-[580px] max-h-[calc(100vh-4rem)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slide-up">
          <div className="px-5 py-4 border-b border-border flex items-center gap-3 bg-gradient-to-r from-card to-muted/30 shrink-0">
            <div className="relative">
              <div className="h-11 w-11 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-2 ring-primary/10">
                <span className="text-sm font-bold text-primary">{leaderInitials}</span>
              </div>
              <span className={cn(
                "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card",
                leader.is_online ? "bg-accent animate-pulse" : "bg-muted-foreground/40"
              )} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-foreground truncate">{leader.name}</p>
                <BadgeCheck className="h-4 w-4 text-primary shrink-0" />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {statusText}
              </p>
            </div>
            <button onClick={() => setOpen(false)} className="h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center transition-colors">
              <Minus className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loadError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-[12px] text-destructive flex items-center justify-between gap-2">
                <span>Verlauf konnte nicht geladen werden.</span>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={loadHistory}>
                  <RefreshCw className="h-3 w-3" /> Erneut versuchen
                </Button>
              </div>
            )}
            {humanMessages.map((msg) => {
              const isMine = msg.sender_id === user?.id;
              return (
                <div key={msg.id} className={cn("flex flex-col", isMine ? "items-end" : "items-start")}>
                  <div className={cn(
                    "max-w-[85%] px-4 py-2.5 text-[13px] leading-relaxed",
                    isMine ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm shadow-sm" : "bg-muted border border-border text-foreground rounded-2xl rounded-bl-sm"
                  )}>
                    <p className="whitespace-pre-wrap">{msg.message}</p>
                    {msg.attachment_url && msg.attachment_type && (
                      <AttachmentPreview
                        url={msg.attachment_url}
                        name={msg.attachment_name ?? "Anhang"}
                        type={msg.attachment_type}
                      />
                    )}
                    <p className={cn("text-[9px] mt-1 opacity-50")}>{formatTime(msg.created_at)}</p>
                  </div>
                </div>
              );
            })}
            {leaderTyping && (
              <div className="flex items-center gap-1.5 text-[10px] text-primary font-medium animate-pulse">
                <span>{leader.name} tippt gerade live...</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-border px-4 py-3 shrink-0 bg-card space-y-2">
            {pendingAttachment && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-[11px]">
                <span className="truncate">📎 {pendingAttachment.name}</span>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setPendingAttachment(null)}
                >
                  Entfernen
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              {user && (
                <ChatAttachmentButton
                  userId={user.id}
                  onUploaded={(a) => setPendingAttachment(a)}
                  disabled={sending}
                />
              )}
              <Input
                value={newMessage}
                onChange={(e) => { setNewMessage(e.target.value); broadcastTyping(); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Nachricht an Teamleiter…"
                className="flex-1 h-10 rounded-xl text-sm border-border/60 focus-visible:ring-primary/20"
              />
              <Button size="icon" onClick={sendMessage} disabled={(!newMessage.trim() && !pendingAttachment) || sending} className="h-10 w-10 rounded-xl">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
