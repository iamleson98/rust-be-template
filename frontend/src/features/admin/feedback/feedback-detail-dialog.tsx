'use client'

/**
 * Moderation detail dialog of the admin feedback panel — full review
 * content, status actions (approve / reject / hide) and the brand reply
 * editor.
 *
 * Extracted from the original 'src/features/admin/feedback/feedback-panel.tsx'.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, EyeOff, Send, XCircle } from 'lucide-react'
import { StarRating } from '@/features/feedback/star-rating'
import { formatDate, type FeedbackRow } from './helpers'

export function FeedbackDetailDialog({
  selected,
  setSelected,
  replyText,
  setReplyText,
  updating,
  moderate,
  onClose,
}: {
  selected: FeedbackRow | null
  setSelected: React.Dispatch<React.SetStateAction<FeedbackRow | null>>
  replyText: string
  setReplyText: React.Dispatch<React.SetStateAction<string>>
  updating: boolean
  moderate: (
    id: string,
    body: { status?: string; brandReply?: string | null },
    successMsg: string,
  ) => Promise<boolean>
  onClose: () => void
}) {
  return (
    <Dialog open={!!selected} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        {selected && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2.5 pr-6">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                    {(selected.authorName || '?').slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate text-base">{selected.authorName || 'Khách ẩn danh'}</div>
                  <div className="text-xs font-normal text-muted-foreground">
                    {formatDate(selected.createdAt)}
                  </div>
                </div>
              </DialogTitle>
              <DialogDescription className="sr-only">
                Chi tiết phản hồi và kiểm duyệt
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <StarRating value={selected.rating} size="lg" />

              {selected.title && (
                <div className="font-semibold text-sm">{selected.title}</div>
              )}
              {selected.content && (
                <p className="text-sm leading-relaxed text-foreground/90">
                  {selected.content}
                </p>
              )}
              {(selected.tags?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(selected.tags ?? []).map((t) => (
                    <Badge key={t} variant="secondary" className="text-[11px] font-normal">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Status action row */}
              <div className="flex flex-wrap gap-1.5">
                {selected.status !== 'approved' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={updating}
                    onClick={async () => {
                      if (await moderate(selected.id, { status: 'approved' }, 'Đã duyệt phản hồi')) {
                        setSelected({ ...selected, status: 'approved' })
                      }
                    }}
                    className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  >
                    <CheckCircle2 className="size-3.5" /> Duyệt hiển thị
                  </Button>
                )}
                {selected.status !== 'rejected' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={updating}
                    onClick={async () => {
                      if (await moderate(selected.id, { status: 'rejected' }, 'Đã từ chối phản hồi')) {
                        setSelected({ ...selected, status: 'rejected' })
                      }
                    }}
                    className="gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50"
                  >
                    <XCircle className="size-3.5" /> Từ chối
                  </Button>
                )}
                {selected.status !== 'hidden' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={updating}
                    onClick={async () => {
                      if (await moderate(selected.id, { status: 'hidden' }, 'Đã ẩn phản hồi')) {
                        setSelected({ ...selected, status: 'hidden' })
                      }
                    }}
                    className="gap-1.5"
                  >
                    <EyeOff className="size-3.5" /> Ẩn
                  </Button>
                )}
              </div>

              {/* Brand reply editor */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">
                  Phản hồi của hãng xe (hiển thị kèm đánh giá)
                </div>
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Cảm ơn bạn đã phản hồi…"
                  rows={3}
                  className="bg-background text-sm resize-none"
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    size="sm"
                    disabled={updating || !replyText.trim()}
                    onClick={async () => {
                      if (await moderate(selected.id, { brandReply: replyText.trim() }, 'Đã gửi phản hồi')) {
                        setSelected({ ...selected, reply: replyText.trim() })
                      }
                    }}
                    className="gap-1.5"
                  >
                    <Send className="size-3.5" /> Gửi phản hồi
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
