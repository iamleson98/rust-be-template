import { Ban, CheckCircle2, Hand, Mail, Phone, Ticket as TicketIcon, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ChatChannelOut } from '@/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { customerInitial, customerName } from './channel-info'

type ActionProps = {
  label: string
  title: string
  icon: ReactNode
  className: string
  disabled?: boolean
  onClick: () => void
}

function Action({ label, title, icon, className, disabled, onClick }: ActionProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={`h-8 gap-1.5 ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  )
}

type Props = {
  channel: ChatChannelOut
  userOnline: boolean
  typingUser: { name: string } | null
  busy: boolean
  /** Only admins may hand a channel back; the API refuses employees. */
  canRelease: boolean
  onBook: () => void
  onClaim: () => void
  onRelease: () => void
  onClose: () => void
  onBlock: () => void
}

/** Customer identity, "book for customer", and the claim / release / close / block actions. */
export function ConversationHeader({
  channel,
  userOnline,
  typingUser,
  busy,
  canRelease,
  onBook,
  onClaim,
  onRelease,
  onClose,
  onBlock,
}: Props) {
  const t = useT()
  const { user } = channel
  const closed = channel.status === 'closed'
  const assigned = channel.status === 'assigned'
  const badge = assigned
    ? channel.assignedTo?.fullName
      ? t('adminChat.processingWithAgent', { name: channel.assignedTo.fullName })
      : t('chat.processing')
    : closed
      ? t('admin.stats.closedCount')
      : t('adminChat.waitingShort')

  return (
    <div className="px-4 py-3 border-b bg-linear-to-r from-blue-50 to-blue-50 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-bold">
            {customerInitial(channel)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate flex items-center gap-2">
            {customerName(channel)}
            {userOnline && (
              <span
                className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"
                title={t('chat.online')}
              />
            )}
          </div>
          <div className="text-[11px] text-muted-foreground truncate flex items-center gap-2">
            {typingUser ? (
              <span className="text-blue-600 italic">
                {t('chat.typing', { name: typingUser.name })}
              </span>
            ) : (
              <>
                {user?.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {user.phone}
                  </span>
                )}
                {user?.email && user.email !== customerName(channel) && (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {user.email}
                  </span>
                )}
                {!user?.phone && !user?.email && channel.topic}
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
          onClick={onBook}
          title={t('chat.bookForCustomer')}
        >
          <TicketIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('chat.bookForCustomer')}</span>
        </Button>
        {!closed && (
          <>
            {!channel.assignedToMe && (
              <Action
                label={t('adminChat.claimChannel')}
                title={t('adminChat.claimChannelTitle')}
                icon={<Hand className="h-3.5 w-3.5" />}
                className="text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100"
                disabled={busy}
                onClick={onClaim}
              />
            )}
            {channel.assignedToMe && canRelease && (
              <Action
                label={t('adminChat.releaseChannel')}
                title={t('adminChat.releaseChannelTitle')}
                icon={<Undo2 className="h-3.5 w-3.5" />}
                className="text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100"
                disabled={busy}
                onClick={onRelease}
              />
            )}
            <Action
              label={t('common.close')}
              title={t('adminChat.closeChannelTitle')}
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              className="text-slate-600 border-slate-200 hover:bg-slate-100"
              disabled={busy}
              onClick={onClose}
            />
          </>
        )}
        <Badge
          className={`text-[10px] border-0 ${assigned ? 'bg-blue-100 text-blue-700' : closed ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'}`}
        >
          {badge}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
          onClick={onBlock}
          title={t('chat.blockChannel')}
        >
          <Ban className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
