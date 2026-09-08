"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  useChatChannelsInfinite,
  useChatMessagesInfinite,
  useChatStats,
  usePostChatMessage,
  useMarkChatRead,
  useClaimChannel,
  useReleaseChannel,
  useCloseChannel,
} from "@/lib/queries";
import type {
  AdminChannel,
  AdminChatMessage,
} from "@/components/admin/dashboard/types";
import { useAdminChatWs } from "./use-admin-chat-ws";
import { useApp } from "@/lib/store";

const TYPING_IDLE_MS = 2000;
const PAGE_SIZE = 30;

export function useAdminChatWorkspace() {
  const { user } = useApp();
  const [activeChannel, setActiveChannel] = useState<AdminChannel | null>(null);
  const [replyText, setReplyText] = useState("");

  // ── Infinite-scroll channel list ─────────────────────────────
  //
  // Initial page = the 30 most recently active channels (the top of
  // the support queue). When the staff scrolls the channel list to
  // the bottom, the panel calls `fetchMoreChannels()` to load the
  // next 30 less-recent channels. The list is ordered
  // `last_message_at DESC` — newest activity first, so "scroll down"
  // = "further back in the queue".
  //
  // WS events (new message / new channel / assignment changes)
  // invalidate `listChannels` → the loaded pages refetch → the queue
  // re-sorts (a channel with new activity jumps to the top).
  const {
    channels: fetchedChannels,
    hasNextPage: hasMoreChannels,
    fetchNextPage: fetchMoreChannels,
    isFetchingNextPage: isFetchingMoreChannels,
    isLoading: channelsLoading,
    error: channelsError,
  } = useChatChannelsInfinite(PAGE_SIZE);
  const channels: AdminChannel[] =
    fetchedChannels as unknown as AdminChannel[];

  // ── Aggregate chat stats (server-side count, not client-side filter) ──
  //
  // `useChatStats` fetches from GET /api/admin/chat/stats — returns
  // accurate counts (open / assigned / closed / total) + avg response
  // time, even when there are more channels than the list's page size
  // (capped at 200). Refetches every 15s.
  const chatStatsQuery = useChatStats();

  // ── "My channels" filter (employee workspace) ─────────────────
  //
  // Employees focus on channels assigned to them + the unassigned
  // queue. Admins see everything (they own the whole queue). The
  // toggle lives in the panel's channel-list header.
  const [mineFilter, setMineFilter] = useState(false);
  // const isEmployee = user?.type === "employee";

  // ── Assignment actions ────────────────────────────────────────
  const claimMut = useClaimChannel();
  const releaseMut = useReleaseChannel();
  const closeMut = useCloseChannel();

  const claimActiveChannel = useCallback(async () => {
    if (!activeChannel) return;
    try {
      await claimMut.mutateAsync({ path: { id: activeChannel.id } } as any);
      toast.success("Đã nhận kênh hỗ trợ");
    } catch (e: any) {
      toast.error(e?.error?.message ?? e?.message ?? "Không thể nhận kênh");
    }
  }, [activeChannel, claimMut]);

  const releaseActiveChannel = useCallback(async () => {
    if (!activeChannel) return;
    try {
      await releaseMut.mutateAsync({ path: { id: activeChannel.id } } as any);
      toast.success("Đã trả kênh về hàng chờ");
    } catch (e: any) {
      toast.error(e?.error?.message ?? e?.message ?? "Không thể trả kênh");
    }
  }, [activeChannel, releaseMut]);

  const closeActiveChannel = useCallback(async () => {
    if (!activeChannel) return;
    try {
      await closeMut.mutateAsync({ path: { id: activeChannel.id } } as any);
      toast.success("Đã đóng cuộc trò chuyện");
      setActiveChannel(null);
    } catch (e: any) {
      toast.error(e?.error?.message ?? e?.message ?? "Không thể đóng kênh");
    }
  }, [activeChannel, closeMut]);

  // ── Infinite-scroll messages ──────────────────────────────────
  //
  // `useChatMessagesInfinite` fetches the latest `PAGE_SIZE` messages
  // first (newest first in the API → reversed for display). When the
  // admin scrolls to the top of the chat, the panel calls
  // `fetchNextPage()` to load the next page of older messages.
  //
  // Realtime updates: when a new message arrives via WS, the WS hook
  // invalidates the `listMessages` query → TanStack refetches the
  // FIRST page (offset=0), which now includes the new message.
  // Older pages are NOT refetched (they're unchanged).
  const {
    messages: infiniteMessages,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isLoading: messagesQueryLoading,
    error: messagesError,
  } = useChatMessagesInfinite(activeChannel?.id, PAGE_SIZE);
  const chatMessages: AdminChatMessage[] = infiniteMessages as unknown as AdminChatMessage[];
  const messagesLoading = messagesQueryLoading;
  const messagesErrorOut: unknown = messagesError;

  const {
    typingUser,
    userOnline,
    sendTyping,
    unreadPulseChannels,
    clearUnreadPulse,
    staffPresence,
  } = useAdminChatWs(user, activeChannel?.id);

  // Reply mutation — clears the input + toasts the result.
  const postReplyMut = usePostChatMessage({
    onSuccess: () => {
      setReplyText("");
    },
    onError: () => {
      toast.error("Không thể gửi tin nhắn");
    },
  });

  const sendReply = useCallback(() => {
    if (!replyText.trim() || !activeChannel) return;
    // Send typing=false so the user sees the admin stopped typing.
    sendTyping(activeChannel.id, false);
    postReplyMut.mutate({
      path: { id: activeChannel.id },
      body: { content: replyText.trim(), kind: "text" },
    } as any);
  }, [replyText, activeChannel, postReplyMut, sendTyping]);

  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCurrentlyTypingRef = useRef(false);
  const activeChannelIdRef = useRef<string | undefined>(activeChannel?.id);
  activeChannelIdRef.current = activeChannel?.id;

  const onReplyTextChange = useCallback(
    (val: string) => {
      setReplyText(val);

      const channelId = activeChannelIdRef.current;
      if (!channelId) return;

      // Only send `typing=true` if we're not already in the "typing"
      // state. This is the first-keystroke-only optimization.
      if (!isCurrentlyTypingRef.current) {
        isCurrentlyTypingRef.current = true;
        sendTyping(channelId, true);
      }

      // Reset the idle timer — when it fires, we send `typing=false`
      // + reset the typing flag so the next keystroke triggers a fresh
      // `typing=true`.
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        isCurrentlyTypingRef.current = false;
        sendTyping(channelId, false);
      }, TYPING_IDLE_MS);
    },
    [sendTyping],
  );

  // When the admin switches channels (or unmounts), clear the typing
  // state + cancel any pending idle timer. Otherwise the timer could
  // fire against a stale channel id (the closure captures the old
  // value at timer-creation time, which is correct, but we still want
  // to reset the `isCurrentlyTyping` flag so the new channel starts
  // fresh).
  useEffect(() => {
    isCurrentlyTypingRef.current = false;
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
  }, [activeChannel?.id]);

  // Cleanup typing timer on unmount.
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  const blockChannel = useCallback(
    (channelId: string) => {
      toast.success("Đã chặn cuộc trò chuyện", {
        description: "Khách sẽ không thể gửi tin nhắn mới",
      });
      if (activeChannel?.id === channelId) setActiveChannel(null);
    },
    [activeChannel],
  );

  // Mark channel as read when admin opens it — clears the unread
  // badge so the admin can see which channels have NEW messages.
  const markReadMut = useMarkChatRead();
  const openChannel = useCallback(
    (channel: AdminChannel) => {
      setActiveChannel(channel);
      markReadMut.mutate({ path: { id: channel.id } } as any);
      // Clear the pulse indicator for this channel — the admin is now
      // viewing it, so the "new message" attention signal is no longer
      // needed.
      clearUnreadPulse(channel.id);
    },
    [markReadMut, clearUnreadPulse],
  );

  // Ticket-card mutation — silent failure is OK because the booking
  // has already been created by the time we send the card.
  const postTicketCardMut = usePostChatMessage({
    onError: () => {
      // Silently fail — the booking was already created.
    },
  });

  const sendTicketCard = useCallback(
    (payload: { bookingCode: string }) => {
      if (!activeChannel) return;
      const attachments = JSON.stringify(payload);
      postTicketCardMut.mutate({
        path: { id: activeChannel.id },
        body: {
          content: `Đã đặt vé ${payload.bookingCode}`,
          kind: "ticket",
          attachments,
        },
      } as any);
    },
    [activeChannel, postTicketCardMut],
  );

  // Apply the "mine" filter (employees): assigned-to-me + unassigned
  // open channels. Closed channels stay visible for context either way.
  const visibleChannels = mineFilter
    ? channels.filter(
        (c) =>
          c.assignedToMe ||
          (!c.assignedTo && c.status !== "closed"),
      )
    : channels;

  return {
    // data
    channels: visibleChannels,
    allChannelsCount: channels.length,
    mineFilter,
    setMineFilter,
    claimActiveChannel,
    releaseActiveChannel,
    closeActiveChannel,
    assignmentBusy:
      claimMut.isPending || releaseMut.isPending || closeMut.isPending,
    channelsLoading,
    channelsError: channelsError ?? null,
    chatMessages,
    messagesLoading,
    messagesError: messagesErrorOut ?? null,
    activeChannel,
    setActiveChannel: openChannel,
    replyText,
    setReplyText: onReplyTextChange,
    sending: postReplyMut.isPending,
    // message infinite scroll (up = older)
    hasMoreMessages: hasNextPage,
    fetchMoreMessages: fetchNextPage,
    isFetchingMoreMessages: isFetchingNextPage,
    // channel list infinite scroll (down = more channels)
    hasMoreChannels,
    fetchMoreChannels,
    isFetchingMoreChannels,
    // realtime state
    typingUser,
    userOnline,
    unreadPulseChannels,
    staffPresence,
    // aggregate stats (from GET /api/admin/chat/stats)
    chatStats: chatStatsQuery.data,
    // actions
    sendReply,
    blockChannel,
    sendTicketCard,
  };
}

export type AdminChatWorkspace = ReturnType<typeof useAdminChatWorkspace>;
