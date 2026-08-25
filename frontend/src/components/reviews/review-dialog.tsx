'use client'

import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCreateReview } from '@/lib/queries'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
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
  ThumbsUp,
  Send,
  Loader2,
  Check,
  Sparkles,
  Bus,
  Route as RouteIcon,
  Upload,
  X,
  Image as ImageIcon,
} from 'lucide-react'
import { toast } from 'sonner'

type Props = {
  open: boolean
  onClose: () => void
  tripSessionId?: string
  bookingId?: string
  routeId: string
  brandId: string
  brandName: string
  routeName: string
  authorName?: string
  authorPhone?: string
  onSubmitSuccess?: () => void
}

const MAX_PHOTOS = 4
const MAX_PHOTO_SIZE = 2 * 1024 * 1024 // 2MB

const TAG_OPTIONS: { key: string; label: string; emoji: string }[] = [
  { key: 'on_time', label: 'Đúng giờ', emoji: '⏱️' },
  { key: 'clean', label: 'Sạch sẽ', emoji: '✨' },
  { key: 'friendly_driver', label: 'Tài xế thân thiện', emoji: '😊' },
  { key: 'comfortable', label: 'Thoải mái', emoji: '🛋️' },
  { key: 'value', label: 'Đáng đồng tiền', emoji: '💰' },
  { key: 'easy_booking', label: 'Đặt dễ', emoji: '🎟️' },
  { key: 'good_wifi', label: 'Wifi mạnh', emoji: '📶' },
  { key: 'safe_drive', label: 'Lái xe an toàn', emoji: '🛡️' },
]

/**
 * Zod schema for the dialog-hosted review form.
 *   - rating 1-5 (required)
 *   - title ≤ 120 chars (optional)
 *   - content ≤ 1500 chars (optional, no min length on this dialog)
 *   - author ≤ 80 chars (optional — defaults to "Hành khách" on submit)
 *   - tags, photos: optional arrays
 */
const reviewSchema = z.object({
  rating: z
    .number()
    .min(1, 'Vui lòng chọn số sao đánh giá')
    .max(5, 'Đánh giá tối đa 5 sao'),
  title: z.string().trim().max(255, 'Tiêu đề tối đa 255 ký tự'),
  content: z.string().trim().max(10000, 'Nhận xét quá dài'),
  author: z.string().trim().max(255, 'Tên hiển thị tối đa 255 ký tự'),
  // Backend enforces max 20 tags + max 10 photos.
  tags: z.array(z.string()).max(20, 'Tối đa 20 thẻ'),
  photos: z.array(z.string()).max(10, 'Tối đa 10 ảnh'),
})

type ReviewValues = z.infer<typeof reviewSchema>

export function ReviewDialog({
  open,
  onClose,
  tripSessionId,
  bookingId,
  routeId,
  brandId,
  brandName,
  routeName,
  authorName,
  authorPhone,
  onSubmitSuccess,
}: Props) {
  const [hoverRating, setHoverRating] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const form = useForm<ReviewValues>({
    resolver: zodResolver(reviewSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      rating: 0,
      title: '',
      content: '',
      author: authorName ?? '',
      tags: [],
      photos: [],
    },
  })

  const rating = form.watch('rating')

  const handlePickPhotos = async (files: FileList | null) => {
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
    // Reset input value so same file can be picked again after removal.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removePhoto = (idx: number) => {
    const current = form.getValues('photos')
    form.setValue(
      'photos',
      current.filter((_, i) => i !== idx),
      { shouldDirty: true, shouldValidate: true },
    )
  }

  const createReviewMut = useCreateReview({
    onSuccess: () => {
      setSubmitted(true)
      onSubmitSuccess?.()
      toast.success('Cảm ơn đánh giá của bạn!')
    },
    onError: () => {
      toast.error('Không thể gửi đánh giá')
    },
    onSettled: () => {
      setSubmitting(false)
    },
  })

  const onSubmit = (values: ReviewValues) => {
    if (!routeId || !brandId) {
      toast.error('Thiếu thông tin tuyến/hãng để gửi đánh giá')
      return
    }
    setSubmitting(true)
    createReviewMut.mutate({
      body: {
        tripSessionId,
        bookingId,
        routeId,
        brandId,
        rating: values.rating,
        title: values.title.trim(),
        content: values.content.trim(),
        tags: values.tags,
        photos: values.photos,
        authorName: values.author.trim() || 'Hành khách',
        authorPhone: authorPhone,
      },
    } as any)
  }

  const reset = () => {
    form.reset({
      rating: 0,
      title: '',
      content: '',
      author: authorName ?? '',
      tags: [],
      photos: [],
    })
    setHoverRating(0)
    setSubmitted(false)
  }

  const handleClose = () => {
    onClose()
    // delay reset so the close animation isn't interrupted
    setTimeout(reset, 250)
  }

  const displayRating = hoverRating || rating
  const ratingLabels = ['', 'Rất tệ', 'Tệ', 'Bình thường', 'Tốt', 'Rất tốt']
  const ratingEmojis = ['', '😣', '😕', '😐', '🙂', '🤩']

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogTitle className="sr-only">Đánh giá chuyến đi</DialogTitle>
        <DialogDescription className="sr-only">
          Để lại đánh giá cho chuyến đi của bạn
        </DialogDescription>

        {submitted ? (
          <div className="text-center py-8">
            <div className="inline-flex h-20 w-20 rounded-full bg-linear-to-br from-blue-400 to-blue-500 items-center justify-center mb-4">
              <Check className="h-10 w-10 text-white" strokeWidth={3} />
            </div>
            <h3 className="font-bold text-xl mb-1">Cảm ơn đánh giá của bạn!</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Nhận xét của bạn giúp cộng đồng hành khách VeXeVN chọn chuyến đi tốt hơn và giúp hãng
              xe cải thiện dịch vụ.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-50 ring-1 ring-amber-200 px-3 py-1.5">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-medium text-amber-700">+10 điểm tích lũy</span>
            </div>
            <div className="mt-5">
              <Button variant="outline" onClick={handleClose}>
                Đóng
              </Button>
            </div>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <h3 className="font-bold text-lg">Đánh giá chuyến đi</h3>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="gap-1 bg-blue-50">
                    <Bus className="h-3 w-3" />
                    {brandName}
                  </Badge>
                  <Badge variant="outline" className="gap-1 bg-slate-50">
                    <RouteIcon className="h-3 w-3" />
                    {routeName}
                  </Badge>
                </div>
              </div>

              {/* Star rating — custom control */}
              <FormField
                control={form.control}
                name="rating"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex flex-col items-center gap-2 py-2 bg-linear-to-b from-amber-50/50 to-transparent rounded-lg">
                      <div className="text-3xl">{ratingEmojis[displayRating] ?? '🚌'}</div>
                      <div className="flex items-center gap-1.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onMouseEnter={() => setHoverRating(n)}
                            onMouseLeave={() => setHoverRating(0)}
                            onClick={() => field.onChange(n)}
                            className="transition-transform"
                            aria-label={`Đánh giá ${n} sao`}
                          >
                            <Star
                              className={`h-9 w-9 transition-colors ${
                                n <= displayRating
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
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                              active
                                ? 'bg-blue-600 text-white scale-105'
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
                        maxLength={120}
                      />
                    </FormControl>
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
                      Nhận xét chi tiết (tuỳ chọn)
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ''}
                        placeholder="Chia sẻ trải nghiệm của bạn về chuyến đi: thái độ tài xế, cleanliness, tiện nghi..."
                        rows={4}
                        className="resize-none"
                        maxLength={1500}
                      />
                    </FormControl>
                    <div className="text-[10px] text-right text-muted-foreground">
                      {(field.value ?? '').length}/1500
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Author */}
              {!authorName && (
                <FormField
                  control={form.control}
                  name="author"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Tên hiển thị
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          placeholder="VD: Nguyễn Văn A"
                          maxLength={80}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

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
                        className="w-full rounded-xl border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/40 transition-colors py-5 flex flex-col items-center justify-center gap-1.5 text-muted-foreground"
                      >
                        <Upload className="h-5 w-5" />
                        <span className="text-xs font-medium">Thêm ảnh</span>
                        <span className="text-[10px]">
                          Nhấn để chọn tối đa {MAX_PHOTOS} ảnh từ thiết bị
                        </span>
                      </button>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                            className="aspect-square rounded-lg border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/40 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground"
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

              <Button
                type="submit"
                disabled={rating === 0 || submitting || !routeId || !brandId}
                className="w-full gap-2 bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Gửi đánh giá
              </Button>
              <p className="text-[11px] text-center text-muted-foreground">
                <ThumbsUp className="inline h-3 w-3 mr-1" />
                Đánh giá của bạn sẽ được ẩn danh nếu không nhập tên
              </p>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
