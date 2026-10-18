"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ChatMessageView, type ChatChannelView } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Headset, Loader2, Phone, PhoneOff, Send, MessageCircle } from "lucide-react";

interface RealtimeJoin {
  enabled: boolean;
  channelId?: string;
  meetingId?: string | null;
  token?: string | null;
}

export default function SupportPage() {
  const { toast } = useToast();
  const [channel, setChannel] = useState<ChatChannelView | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [realtime, setRealtime] = useState<RealtimeJoin | null>(null);
  const [inCall, setInCall] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const loadMessages = useCallback(async (channelId: string) => {
    try {
      const d = await api.get<{ items: ChatMessageView[] }>(
        `/api/chat/channels/${channelId}/messages?limit=50`,
      );
      setMessages(d.items.reverse());
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ch = await api.post<{ id: string; status: string }>("/api/chat/channels", {});
        if (cancelled) return;
        setChannel({ id: ch.id, status: ch.status, topic: null, lastMessageAt: null, lastMessagePreview: null, unread: 0, createdAt: "", customerName: "" });
        await loadMessages(ch.id);
        // Ask for a Realtime join token (falls back to polling when disabled).
        const rt = await api.post<RealtimeJoin>("/api/realtime/token", { channelId: ch.id }).catch(() => null);
        if (!cancelled && rt) setRealtime(rt);
      } catch (e) {
        if ((e as { status?: number }).status === 401) setUnauthorized(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMessages]);

  // Polling fallback (also used alongside Realtime for durability).
  useEffect(() => {
    if (!channel || inCall) return;
    const t = setInterval(() => loadMessages(channel.id), 4000);
    return () => clearInterval(t);
  }, [channel, inCall, loadMessages]);

  useEffect(scrollToBottom, [messages, scrollToBottom]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!channel || !text.trim()) return;
    setSending(true);
    const clientMsgId = crypto.randomUUID();
    try {
      const msg = await api.post<ChatMessageView>(
        `/api/chat/channels/${channel.id}/messages`,
        { text, clientMsgId },
      );
      setMessages((cur) => [...cur, msg]);
      setText("");
    } catch (err) {
      toast({ title: "Không gửi được tin nhắn", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  const callRef = useRef<{ leave: () => Promise<void> } | null>(null);

  async function startCall() {
    if (!realtime?.token) {
      toast({
        title: "Realtime chưa bật",
        description: "Cuộc gọi thoại cần Cloudflare Realtime (đặt REALTIME_ENABLED=true + cấu hình app).",
      });
      return;
    }
    setInCall(true);
    try {
      // RealtimeKit web SDK (@cloudflare/realtimekit) — audio-only meeting.
      const { default: Client } = await import("@cloudflare/realtimekit");
      const client = await Client.init({
        authToken: realtime.token!,
        defaults: { audio: true, video: false },
      });
      await client.join();
      await client.self.enableAudio();
      callRef.current = client;
      toast({ title: "Đã tham gia cuộc gọi", description: "Mic đang bật — nói chuyện với nhân viên hỗ trợ." });
    } catch (err) {
      setInCall(false);
      toast({ title: "Không vào được cuộc gọi", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function endCall() {
    try {
      await callRef.current?.leave();
    } catch {
      /* already left */
    }
    callRef.current = null;
    setInCall(false);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <MessageCircle className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <p className="mt-3 text-muted-foreground">Đăng nhập để chat với nhân viên hỗ trợ.</p>
        <a href="/login" className="mt-4 inline-block">
          <Button>Đăng nhập</Button>
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Card className="flex h-[70vh] flex-col border">
        <CardHeader className="flex-row items-center border-b py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Headset className="size-5 text-primary" aria-hidden /> Hỗ trợ DatXE Vui
          </CardTitle>
          <Button
            size="sm"
            variant={inCall ? "destructive" : "outline"}
            className="ml-auto"
            onClick={() => (inCall ? endCall() : startCall())}
          >
            {inCall ? (
              <>
                <PhoneOff className="mr-1 size-4" aria-hidden /> Kết thúc
              </>
            ) : (
              <>
                <Phone className="mr-1 size-4" aria-hidden /> Gọi thoại
              </>
            )}
          </Button>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-label="Tin nhắn hỗ trợ">
            {messages.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Chào bạn! Nhân viên hỗ trợ sẵn sàng giúp bạn đặt vé, đổi vé hay khiếu nại.
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.senderType === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                    m.senderType === "user"
                      ? "bg-primary text-primary-foreground"
                      : m.senderType === "assistant"
                        ? "border bg-muted"
                        : "border"
                  }`}
                >
                  {m.senderType !== "user" && (
                    <p className="mb-0.5 text-xs font-medium opacity-70">
                      {m.senderType === "assistant" ? "Trợ lý AI" : "Nhân viên hỗ trợ"}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  <p className={`mt-1 text-[10px] ${m.senderType === "user" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {new Date(m.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={send} className="flex gap-2 border-t p-3" aria-label="Gửi tin nhắn">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Nhập tin nhắn…"
              disabled={sending}
              aria-label="Nội dung tin nhắn"
            />
            <Button type="submit" size="icon" disabled={sending || !text.trim()} aria-label="Gửi">
              {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
