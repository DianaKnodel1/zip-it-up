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
import { MessageCircle, Send, BadgeCheck, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  read: boolean;
  created_at: string;
  is_ai?: boolean;
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
  const { leader, teamLeaderId, initials: leaderInitials } = useTeamLeader();
  const { tenant } = useTenant();
  
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [humanMessages, setHumanMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [leaderTyping, setLeaderTyping] = useState(false);
  
  const bottomRef = useRef<HTMLDivElement>(null);
  const isOnChatPage = location.pathname.includes("/chat");

  const { trigger: triggerNotification } = useChatNotifications({ unread, enabled: true });

  useEffect(() => {
    if (!user || !teamLeaderId || isOnChatPage) return;
    const check = async () => {
      const { count } = await supabase
        .from("chat_messages")
        .select("*", { count: "exact", head: true })
        .eq("receiver_id", user.id)
        .eq("sender_id", teamLeaderId)
        .eq("read", false);
      setUnread(count || 0);
      setLoaded(true);
    };
    check();
  }, [user, teamLeaderId, isOnChatPage]);

  useEffect(() => {
    if (!user || !teamLeaderId) return;
    const channel = supabase
      .channel("floating-chat-main")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const msg = payload.new as ChatMessage;
        const isFromLeader = msg.sender_id === teamLeaderId && msg.receiver_id === user.id;
        const isFromMe = msg.sender_id === user.id && msg.receiver_id === teamLeaderId;
        
        if (!isFromLeader && !isFromMe) return;
        if (msg.message.includes("[ESCALATE]") || msg.message.includes("🤖 KI Eskalation")) return;

        if (open) {
          setHumanMessages((prev) => [...prev, msg]);
          if (isFromLeader) {
            supabase.from("chat_messages").update({ read: true } as any).eq("id", msg.id).then();
          }
        } else if (isFromLeader) {
          setUnread((u) => u + 1);
          setHasNewMessage(true);
          triggerNotification({ senderName: leader.name || "Teamleiter", body: msg.message });
        }
      })
      .on("broadcast", { event: "typing" }, (payload) => {
        if (payload.payload.userId === teamLeaderId) {
          setLeaderTyping(true);
          setTimeout(() => setLeaderTyping(false), 3000);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, teamLeaderId, open, leader.name, triggerNotification]);

  useEffect(() => {
    if (!open || !user || !teamLeaderId) return;
    const load = async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${teamLeaderId}),and(sender_id.eq.${teamLeaderId},receiver_id.eq.${user.id})`)
        .not("message", "ilike", "%[ESCALATE]%")
        .not("message", "ilike", "%🤖 KI-Eskalation%")
        .order("created_at", { ascending: true })
        .limit(100);
      setHumanMessages((data ?? []) as ChatMessage[]);
      setUnread(0);
      setHasNewMessage(false);
    };
    load();
  }, [open, user, teamLeaderId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [humanMessages, leaderTyping]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !user || !teamLeaderId) return;
    const text = newMessage.trim();
    setNewMessage("");
    setSending(true);
    try {
      await supabase.from("chat_messages").insert({
        sender_id: user.id,
        receiver_id: teamLeaderId,
        message: text,
      } as any);
    } catch (e) {
      toast({ title: "Fehler", description: "Nachricht konnte nicht gesendet werden.", variant: "destructive" });
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

  if (isOnChatPage || !loaded || !teamLeaderId) return null;

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
                {leader.is_online ? "Jetzt online" : "Zuletzt online gesehen"}
              </p>
            </div>
            <button onClick={() => setOpen(false)} className="h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center transition-colors">
              <Minus className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {humanMessages.map((msg) => {
              const isMine = msg.sender_id === user?.id;
              return (
                <div key={msg.id} className={cn("flex flex-col", isMine ? "items-end" : "items-start")}>
                  <div className={cn(
                    "max-w-[85%] px-4 py-2.5 text-[13px] leading-relaxed",
                    isMine ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm shadow-sm" : "bg-muted border border-border text-foreground rounded-2xl rounded-bl-sm"
                  )}>
                    <p className="whitespace-pre-wrap">{msg.message}</p>
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

          <div className="border-t border-border px-4 py-3 flex items-center gap-2 shrink-0 bg-card">
            <Input
              value={newMessage}
              onChange={(e) => { setNewMessage(e.target.value); broadcastTyping(); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Nachricht an Teamleiter…"
              className="flex-1 h-10 rounded-xl text-sm border-border/60 focus-visible:ring-primary/20"
            />
            <Button size="icon" onClick={sendMessage} disabled={!newMessage.trim() || sending} className="h-10 w-10 rounded-xl">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
