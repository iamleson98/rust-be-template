import { Mail, Phone } from 'lucide-react'
import type { ChatChannelOut } from '@/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { relativeTime } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { ChannelStatusBadge, PriorityBadge } from './channel-badges'
import { customerContact, customerInitial, customerName } from './channel-info'

type Props = {
  channel: ChatChannelOut
  selected: boolean
  /** A customer message arrived here while it was not open. */
  unseen: boolean
  /** The customer is signed in with the site open. */
  online: boolean
  onOpen: () => void
}

/** Green dot on an avatar's lower edge: the customer is online. */
export function OnlineDot({ className = 'size-3' }: { className?: string }) {
  const t = useT()
  return (
    <span
      role="img"
      aria-label={t('chat.online')}
      title={t('chat.online')}
      className={`absolute -right-0.5 -bottom-0.5 rounded-full bg-emerald-500 ring-2 ring-background ${className}`}
    />
  )
}

/** One queue entry: customer, last message, assignee, unread count and status. */
export function ChannelRow({ channel: c, selected, unseen, online, onOpen }: Props) {
  const t = useT()
  const contact = customerContact(c)
  return (
    <button
      onClick={onOpen}
      className={`w-full p-4 hover:bg-slate-50 flex items-center gap-3 text-left transition-colors ${selected ? 'bg-blue-50/50 border-l-2 border-l-blue-600' : ''}`}
    >
      <div className="relative shrink-0">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-slate-200 text-xs font-bold text-slate-600">
            {customerInitial(c)}
          </AvatarFallback>
        </Avatar>
        {unseen && (
          <span
            className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-blue-500 ring-2 ring-white animate-pulse"
            title={t('chat.newMessage')}
          />
        )}
        {online && <OnlineDot />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="font-medium text-sm truncate">{customerName(c)}</div>
          {c.assignedTo?.fullName && (
            <Badge
              className={`text-[10px] border-0 ${c.assignedToMe ? 'bg-blue-600 text-white' : 'bg-indigo-100 text-indigo-700'}`}
              title={t('adminChat.assignedTo', { name: c.assignedTo.fullName })}
            >
              {c.assignedToMe ? t('adminChat.mine') : c.assignedTo.fullName}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <div className="text-xs text-muted-foreground truncate flex-1">
            {c.lastMessagePreview ?? c.topic}
          </div>
          <PriorityBadge />
        </div>
        {contact && (
          <div className="text-[10px] text-muted-foreground/80 truncate mt-0.5 flex items-center gap-1">
            {contact.isPhone ? <Phone className="h-2.5 w-2.5" /> : <Mail className="h-2.5 w-2.5" />}
            {contact.text}
          </div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="text-[10px] text-muted-foreground">
          {c.lastMessageAt ? relativeTime(c.lastMessageAt) : ''}
        </div>
        {c.unreadEmployee > 0 && (
          <Badge className="bg-rose-500 text-white text-[10px] mt-1">
            {t('adminChat.newCount', { count: c.unreadEmployee })}
          </Badge>
        )}
        <ChannelStatusBadge status={c.status} />
      </div>
    </button>
  )
}
