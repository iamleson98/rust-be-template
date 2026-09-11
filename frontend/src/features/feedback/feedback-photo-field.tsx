'use client'

/**
 * FeedbackPhotoField — the optional photo attachment control of the
 * feedback form: hidden file input, empty-state "Thêm ảnh" button,
 * thumbnail grid with per-photo remove, and the pick validation
 * (image type, 2MB cap, max 3 photos, client-side data-URLs).
 *
 * Extracted from the original `feedback-form.tsx` — the pick/remove
 * handlers + `readAsDataURL` helper moved along with the markup.
 */

import { useCallback, useRef } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Upload, X, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { FeedbackValues } from './feedback-schema'

const MAX_PHOTOS = 3
const MAX_PHOTO_SIZE = 2 * 1024 * 1024 // 2MB

export function FeedbackPhotoField({
  form,
}: {
  form: UseFormReturn<FeedbackValues>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  return (
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
