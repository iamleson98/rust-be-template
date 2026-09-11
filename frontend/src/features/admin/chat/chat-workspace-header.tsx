'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Ban,
  Ticket as TicketIcon,
  Phone,
  Mail,
  Hand,
  Undo2,
  CheckCircle2,
} from 'lucide-react'
import type { AdminChannel as Channel } from '@/features/admin/dashboard/types'
import { customerDisplayName, customerInitial } from './chat-helpers'

/**
 * Header of the chat workspace card — the active channel's customer
 * identity (avatar, name, online dot, phone/email), the ticket-picker
 * entry point, and the assignment / block actions.
 */
export function ChatWorkspaceHeader({
  activeChannel,
  userOnline,
  typingUser,
  setPickerOpen,
  onClaim,
  onRelease,
  onCloseChannel,
  assignmentBusy,
  canRelease,
  onBlockChannel,
}: {
  /** The open channel (rendered only when non-null). */
  activeChannel: Channel
  /** Whether the user in the active channel is online. */
  userOnline?: boolean
  /** Typing indicator from the user — null when not typing. */
  typingUser?: { name: string } | null
  /** Opens the "Đặt vé cho khách" picker dialog. */
  setPickerOpen: (v: boolean) => void
  /** Assignment actions on the active channel. */
  onClaim?: () => void
  onRelease?: () => void
  onCloseChannel?: () => void
  assignmentBusy?: boolean
  /**
   * Per the product spec, employees CANNOT leave an assigned channel —
   * only admins may reassign/release. The backend rejects employee
   * releases with 403; this flag hides the button entirely for
   * employees so the UI never offers an action that would fail.
   */
  canRelease?: boolean
  onBlockChannel: (channelId: string) => void
}) {
  return (
    <div className="px-4 py-3 border-b bg-linear-to-r from-blue-50 to-blue-50 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-bold">
            {customerInitial(activeChannel)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate flex items-center gap-2">
            {customerDisplayName(activeChannel)}
            {userOnline && (
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Đang trực tuyến" />
            )}
          </div>
          <div className="text-[11px] text-muted-foreground truncate flex items-center gap-2">
            {typingUser ? (
              <span className="text-blue-600 italic">{typingUser.name} đang gõ...</span>
            ) : (
              <>
                {activeChannel.user?.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {activeChannel.user.phone}
                  </span>
                )}
                {activeChannel.user?.email && activeChannel.user.email !== customerDisplayName(activeChannel) && (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {activeChannel.user.email}
                  </span>
                )}
                {!activeChannel.user?.phone && !activeChannel.user?.email && activeChannel.topic}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="default"
          size="sm"
          className="h-8 gap-1.5 bg-blue-600 hover:bg-blue-700"
          onClick={() => setPickerOpen(true)}
          title="Đặt vé cho khách"
        >
          <TicketIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Đặt vé cho khách</span>
        </Button>
        {activeChannel.status !== 'closed' && (
          <>
            {/* Assignment actions — three-role routing.
                No assignee (or someone else) → claim ("nhận").
                Assignee (or admin) → release + close. */}
            {!activeChannel.assignedToMe && onClaim && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100"
                onClick={onClaim}
                disabled={assignmentBusy}
                title="Nhận kênh này về cho mình"
              >
                <Hand className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Nhận kênh</span>
              </Button>
            )}
            {activeChannel.assignedToMe && onRelease && canRelease && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100"
                onClick={onRelease}
                disabled={assignmentBusy}
                title="Trả kênh về hàng đợi chung"
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Trả kênh</span>
              </Button>
            )}
            {onCloseChannel && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-slate-600 border-slate-200 hover:bg-slate-100"
                onClick={onCloseChannel}
                disabled={assignmentBusy}
                title="Đóng cuộc trò chuyện"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Đóng</span>
              </Button>
            )}
          </>
        )}
        <Badge className={`text-[10px] border-0 ${activeChannel.status === 'assigned' ? 'bg-blue-100 text-blue-700' : activeChannel.status === 'closed' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>
          {activeChannel.status === 'assigned'
            ? `Đang xử lý${activeChannel.assignedTo?.fullName ? ` · ${activeChannel.assignedTo.fullName}` : ''}`
            : activeChannel.status === 'closed'
              ? 'Đã đóng'
              : 'Chờ'}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
          onClick={() => onBlockChannel(activeChannel.id)}
          title="Chặn cuộc trò chuyện"
        >
          <Ban className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
