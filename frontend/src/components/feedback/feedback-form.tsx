'use client'

import { memo, useState, useRef, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Star,
  Send,
  Loader2,
  Check,
  Sparkles,
  Bus,
  Route as RouteIcon,
  Upload,
  X,
  Image as ImageIcon,
  Pencil,
  AlertCircle,
  Quote,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCreateReview, useUpdateReview } from '@/lib/queries'
import { BookingItem, ReviewSummary, REVIEW_TAG_LABELS } from '@/components/bookings/booking-types'

type Props = {
  booking: BookingItem
  /** Existing review (if any) — when provided the form renders in "view/edit" mode. */
  existingReview?: ReviewSummary | null
  /** Called after a successful submit OR edit — parent should refresh state. */
  onSubmitted?: (review: ReviewSummary) => void
  /** Called when the user clicks "Đóng" / cancels. */
  onClose?: () => void
}

const MAX_PHOTOS = 3
const MAX_PHOTO_SIZE = 2 * 1024 * 1024 // 2MB

const TAG_OPTIONS = Object.entries(REVIEW_TAG_LABELS).map(([key, v]) => ({
  key,
  label: v.label,
  emoji: v.emoji,
}))

/**
 * Zod schema for the review form.
 *   - rating 1-5 (required, must be > 0)
 *   - title ≤ 80 chars (optional)
 *   - content ≤ 2000 chars, ≥ 20 chars if non-empty (optional but recommended)
 *   - tags: optional array of strings
 *   - photos: optional array of data-URL/HTTP strings
 */
const feedbackSchema = z.object({
  rating: z
    .number()
    .min(1, 'Vui lòng chọn số sao đánh giá')
    .max(5, 'Đánh giá tối đa 5 sao'),
  title: z.string().trim().max(255, 'Tiêu đề tối đa 255 ký tự'),
  content: z
    .string()
    .trim()
    .max(10000, 'Nhận xét quá dài')
    .refine(
      (val) => val.length === 0 || val.length >= 20,
      'Nội dung đánh giá cần ít nhất 20 ký tự để gửi',
    ),
  // Backend enforces max 20 tags + max 10 photos.
  tags: z.array(z.string()).max(20, 'Tối đa 20 thẻ'),
  photos: z.array(z.string()).max(10, 'Tối đa 10 ảnh'),
})

type FeedbackValues = z.infer<typeof feedbackSchema>

/**
 * FeedbackForm — inline review form rendered below a completed BookingCard.
 *
 * - If `existingReview` is provided: renders the review read-only with an
 *   "Chỉnh sửa" toggle to switch into edit mode (PATCH /api/reviews/[id]).
 * - Otherwise: renders an empty form (POST /api/reviews).
 *
 * Validation mirrors the server and is enforced by zod via react-hook-form.
 */
export const FeedbackForm = memo(function FeedbackForm({ booking, existingReview, onSubmitted, onClose }: Props) {
  const isEditingExisting = !!existingReview
  const [editMode, setEditMode] = useState(!isEditingExisting)
  const [hoverRating, setHoverRating] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Two mutations defined at HOOK CREATION — each carries its own
  // onSuccess/onError. mutate() takes only the params.
  const createMut = useCreateReview({
    onSuccess: (data: any) => {
      const review: ReviewSummary = data?.review ?? data?.data?.review
      if (review) onSubmitted?.(review)
      setSubmitted(true)
      toast.success('Cảm ơn đánh giá của bạn!')
    },
    onError: () => {
      toast.error('Không thể gửi đánh giá')
    },
  })

  const updateMut = useUpdateReview({
    onSuccess: (data: any) => {
      const review: ReviewSummary = data?.review ?? data?.data?.review
      if (review) onSubmitted?.(review)
      setSubmitted(true)
      toast.success('Đã cập nhật đánh giá!')
    },
    onError: () => {
      toast.error('Không thể cập nhật đánh giá')
    },
  })

  const submitting = createMut.isPending || updateMut.isPending

  const form = useForm<FeedbackValues>({
    resolver: zodResolver(feedbackSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      rating: existingReview?.rating ?? 0,
      title: existingReview?.title ?? '',
      content: existingReview?.content ?? '',
      tags: existingReview?.tags ?? [],
      photos: existingReview?.photos ?? [],
    },
  })

  // Live-watched values (for inline disabled-state + counter UX)
  const rating = form.watch('rating')
  const comment = form.watch('content')

  const handlePickPhotos = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      const current = form.getValues('photos')
      const slotsLeft = MAX_PHOTOS - current.length
      if (slotsLeft <= 0) {
        toast.error(`Chỉ được đính kèm tối đa ${MAX_PHOTOS} ảnh`)
        return
      }
      const picked = Array.from(files).slice(0, slotsLeft)
      const next: string[] = []
      for (const f of picked) {
        if (!f.type.startsWith('image/')) {
          toast.error(`"${f.name}" không phải ảnh`)
          continue
        }
        if (f.size > MAX_PHOTO_SIZE) {
          toast.error(`"${f.name}" vượt quá 2MB`)
          continue
        }
        try {
          const dataUrl = await readAsDataURL(f)
          next.push(dataUrl)
        } catch {
          toast.error(`Không thể đọc "${f.name}"`)
        }
      }
      if (next.length > 0) {
        const updated = [...current, ...next].slice(0, MAX_PHOTOS)
        form.setValue('photos', updated, { shouldDirty: true, shouldValidate: true })
      }
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [form],
  )

  const removePhoto = (idx: number) => {
    const current = form.getValues('photos')
    form.setValue(
      'photos',
      current.filter((_, i) => i !== idx),
      { shouldDirty: true, shouldValidate: true },
    )
  }

  const onSubmit = (values: FeedbackValues) => {
    if (!booking.trip?.routeId || !booking.trip?.brandId) {
      toast.error('Thiếu thông tin tuyến/hãng để gửi đánh giá')
      return
    }
    const payload = {
      body: {
        bookingId: booking.id,
        rating: values.rating,
        title: values.title.trim(),
        content: values.content.trim(),
        tags: values.tags,
        photos: values.photos,
      },
    } as any
    if (existingReview) {
      updateMut.mutate({ path: { id: existingReview.id }, ...payload })
    } else {
      createMut.mutate(payload)
    }
  }

  const reset = () => {
    form.reset({
      rating: 0,
      title: '',
      content: '',
      tags: [],
      photos: [],
    })
    setHoverRating(0)
    setSubmitted(false)
  }

  const displayRating = hoverRating || rating
  const ratingLabels = ['', 'Rất tệ', 'Tệ', 'Bình thường', 'Tốt', 'Rất tốt']
  const ratingEmojis = ['', '😣', '😕', '😐', '🙂', '🤩']

  const accent = booking.trip?.brandAccent ?? '#2563eb'
  const isShortComment =
    comment.trim().length > 0 && comment.trim().length < 20

  // ─── "Read-only" view for an existing review ─────────────────
  if (isEditingExisting && !editMode) {
    return (
      <Card className="ring-1 ring-amber-200 overflow-hidden">
        <div className="h-1 bg-linear-to-r from-amber-400 to-orange-500" />
        <CardContent className="p-4 md:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
              <Sparkles className="h-3.5 w-3.5" />
              Đánh giá của bạn về chuyến này
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={() => setEditMode(true)}
            >
              <Pencil className="h-3 w-3" />
              Chỉnh sửa
            </Button>
          </div>

          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                className={`h-4 w-4 ${s <= (existingReview?.rating ?? 0)
                  ? 'fill-amber-400 text-amber-400'
                  : 'fill-slate-100 text-slate-200'
                  }`}
              />
            ))}
            <span className="ml-1.5 text-xs font-bold text-amber-600">
              {(existingReview?.rating ?? 0).toFixed(1)}
            </span>
          </div>

          {existingReview?.title && (
            <div className="flex items-start gap-2">
              <Quote className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <h4 className="font-bold text-sm md:text-base text-foreground leading-snug">
                {existingReview.title}
              </h4>
            </div>
          )}

          {existingReview?.content && (
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line pl-6">
              {existingReview.content}
            </p>
          )}

          {existingReview && existingReview.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {existingReview.tags.map((t, i) => {
                const meta = REVIEW_TAG_LABELS[t]
                return (
                  <Badge
                    key={`${t}-${i}`}
                    variant="outline"
                    className="text-[11px] gap-1 px-2 py-0.5 bg-amber-50/60 border-amber-200/60 text-amber-800 font-medium"
                  >
                    {meta ? (
                      <>
                        <span>{meta.emoji}</span>
                        {meta.label}
                      </>
                    ) : (
                      t.replace(/_/g, ' ')
                    )}
                  </Badge>
                )
              })}
            </div>
          )}

          {existingReview && existingReview.photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 pt-1">
              {existingReview.photos.map((src, i) => (
                <a
                  key={i}
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aspect-square rounded-lg overflow-hidden ring-1 ring-black/5 hover:ring-amber-400 transition-all"
                >
                  <img src={src} alt={`Ảnh ${i + 1}`} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                </a>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-dashed border-slate-200">
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={onClose}>
              Đóng
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Cảm ơn bạn đã chia sẻ trải nghiệm!
            </span>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ─── "Submitted" success state ─────────────────────────────
  if (submitted) {
    return (
      <Card className="ring-1 ring-amber-200 overflow-hidden">
        <div className="h-1 bg-linear-to-r from-amber-400 to-orange-500" />
        <CardContent className="p-6 text-center">
          <div className="inline-flex h-16 w-16 rounded-full bg-linear-to-br from-amber-400 to-orange-500 items-center justify-center mb-3">
            <Check className="h-8 w-8 text-white" strokeWidth={3} />
          </div>
          <h4 className="font-bold text-lg mb-1">Cảm ơn đánh giá của bạn!</h4>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Nhận xét của bạn giúp cộng đồng hành khách VeXeVN chọn chuyến đi tốt hơn và giúp hãng xe
            cải thiện dịch vụ.
          </p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-50 ring-1 ring-amber-200 px-3 py-1.5">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-medium text-amber-700">+10 điểm tích lũy</span>
          </div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditMode(false)
                reset()
              }}
            >
              Đóng
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ─── Editable form (POST new OR PATCH existing) ────────────
  return (
    <Card className="ring-1 ring-amber-200 overflow-hidden">
      <div className="h-1 bg-linear-to-r from-amber-400 to-orange-500" />
      <CardContent className="p-4 md:p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h4 className="font-bold text-base flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-amber-500" />
              {existingReview ? 'Chỉnh sửa đánh giá' : 'Đánh giá chuyến đi'}
            </h4>
            <div className="mt-1 flex items-center gap-2 text-xs">
              <Badge variant="outline" className="gap-1 bg-blue-50">
                <Bus className="h-3 w-3" />
                {booking.trip?.brandName ?? 'Nhà xe'}
              </Badge>
              <Badge variant="outline" className="gap-1 bg-slate-50">
                <RouteIcon className="h-3 w-3" />
                {booking.trip?.fromName} → {booking.trip?.toName}
              </Badge>
            </div>
          </div>
          {existingReview && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => setEditMode(false)}
            >
              Hủy chỉnh sửa
            </Button>
          )}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Star rating — custom control */}
            <FormField
              control={form.control}
              name="rating"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex flex-col items-center gap-1.5 py-2 bg-linear-to-b from-amber-50/60 to-transparent rounded-lg">
                    <div className="text-3xl">{ratingEmojis[displayRating] ?? '🚌'}</div>
                    <div className="flex items-center gap-1.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onMouseEnter={() => setHoverRating(n)}
                          onMouseLeave={() => setHoverRating(0)}
                          onClick={() => field.onChange(n)}
                          className="transition-transform hover:scale-110"
                          aria-label={`Đánh giá ${n} sao`}
                          type="button"
                        >
                          <Star
                            className={`h-8 w-8 transition-colors ${n <= displayRating
                              ? 'fill-amber-400 text-amber-400 drop-'
                              : 'fill-slate-100 text-slate-300'
                              }`}
                          />
                        </button>
                      ))}
                    </div>
                    {displayRating > 0 && (
                      <span
                        key={displayRating}
                        className="text-sm font-semibold text-amber-600"
                        style={{ color: accent }}
                      >
                        {ratingLabels[displayRating]}
                      </span>
                    )}
                  </div>
                  <FormMessage className="text-center" />
                </FormItem>
              )}
            />

            {/* Tag picker — custom control */}
            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Điểm nổi bật (chọn nhiều)
                  </FormLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {TAG_OPTIONS.map((t) => {
                      const active = (field.value ?? []).includes(t.key)
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() =>
                            field.onChange(
                              (field.value ?? []).includes(t.key)
                                ? (field.value ?? []).filter((k) => k !== t.key)
                                : [...(field.value ?? []), t.key],
                            )
                          }
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${active
                            ? 'bg-amber-500 text-white scale-105'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                        >
                          <span>{t.emoji}</span>
                          {t.label}
                        </button>
                      )
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Tiêu đề (tuỳ chọn)
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="VD: Chuyến đi tuyệt vời, đúng giờ!"
                      maxLength={80}
                    />
                  </FormControl>
                  <div className="text-[10px] text-right text-muted-foreground">
                    {(field.value ?? '').length}/80
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Comment */}
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

            {/* Photo upload */}
            <FormField
              control={form.control}
              name="photos"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Ảnh đi kèm (tuỳ chọn)
                    </FormLabel>
                    <span className="text-[10px] text-muted-foreground">
                      {(field.value ?? []).length}/{MAX_PHOTOS} ảnh · tối đa 2MB/ảnh
                    </span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handlePickPhotos(e.target.files)}
                  />
                  {(field.value ?? []).length === 0 ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full rounded-xl border-2 border-dashed border-slate-300 hover:border-amber-400 hover:bg-amber-50/40 transition-colors py-4 flex flex-col items-center justify-center gap-1 text-muted-foreground"
                    >
                      <Upload className="h-5 w-5" />
                      <span className="text-xs font-medium">Thêm ảnh</span>
                      <span className="text-[10px]">
                        Nhấn để chọn tối đa {MAX_PHOTOS} ảnh từ thiết bị
                      </span>
                    </button>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {(field.value ?? []).map((src, i) => (
                        <div
                          key={i}
                          className="relative aspect-square rounded-lg overflow-hidden ring-1 ring-black/5 group"
                        >
                          <img
                            src={src}
                            alt={`Ảnh ${i + 1}`}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                          <button
                            type="button"
                            onClick={() => removePhoto(i)}
                            className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 hover:bg-rose-600 text-white inline-flex items-center justify-center transition-colors"
                            aria-label="Xoá ảnh"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      {(field.value ?? []).length < MAX_PHOTOS && (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="aspect-square rounded-lg border-2 border-dashed border-slate-300 hover:border-amber-400 hover:bg-amber-50/40 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground"
                        >
                          <ImageIcon className="h-4 w-4" />
                          <span className="text-[10px] font-medium">Thêm</span>
                        </button>
                      )}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Submit */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="submit"
                disabled={rating === 0 || submitting || isShortComment}
                className="flex-1 gap-2 bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {existingReview ? 'Lưu chỉnh sửa' : 'Gửi đánh giá'}
              </Button>
              {onClose && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Hủy
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
})

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
