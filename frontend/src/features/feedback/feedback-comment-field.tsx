'use client'

/**
 * FeedbackCommentField — the "Nhận xét chi tiết" textarea of the
 * feedback form, with the character counter and the inline
 * "at least 20 chars" hint.
 *
 * Extracted from the original `feedback-form.tsx`.
 */

import type { UseFormReturn } from 'react-hook-form'
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { AlertCircle } from 'lucide-react'
import type { FeedbackValues } from './feedback-schema'

export function FeedbackCommentField({
  form,
  isShortComment,
}: {
  form: UseFormReturn<FeedbackValues>
  isShortComment: boolean
}) {
  return (
            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Nhận xét chi tiết (tuỳ chọn, tối thiểu 20 ký tự)
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ''}
                      placeholder="Chia sẻ trải nghiệm của bạn về chuyến đi: thái độ tài xế, độ sạch sẽ, tiện nghi..."
                      rows={4}
                      className="resize-none"
                      maxLength={2000}
                    />
                  </FormControl>
                  <div className="text-[10px] text-right text-muted-foreground">
                    {(field.value ?? '').length}/2000
                  </div>
                  {isShortComment && !form.formState.errors.content && (
                    <div className="flex items-center gap-1.5 text-[11px] text-amber-700">
                      <AlertCircle className="h-3 w-3" />
                      Nội dung đánh giá cần ít nhất 20 ký tự để gửi.
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
  )
}
