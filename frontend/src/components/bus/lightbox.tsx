'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

type Props = {
  open: boolean
  images: string[]
  initialIndex?: number
  onClose: () => void
}

export function Lightbox({ open, images, initialIndex = 0, onClose }: Props) {
  const [idx, setIdx] = useState(initialIndex)

  useEffect(() => {
    // When the lightbox opens, snap to the requested image.
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIdx(Math.min(initialIndex, images.length - 1))
    }
  }, [open, initialIndex, images.length])

  const goPrev = useCallback(() => {
    setIdx((i) => (i - 1 + images.length) % images.length)
  }, [images.length])

  const goNext = useCallback(() => {
    setIdx((i) => (i + 1) % images.length)
  }, [images.length])

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    // Lock body scroll
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose, goPrev, goNext])

  return (
    <>
      {open && images.length > 0 && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-100 bg-black/90 backdrop-blur-sm flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Xem ảnh phóng to"
        >
          {/* Top bar */}
          <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 py-3 text-white">
            <div className="text-sm font-medium">
              {idx + 1} / {images.length}
            </div>
            <button
              onClick={onClose}
              className="h-10 w-10 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              aria-label="Đóng"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Prev arrow */}
          {images.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                goPrev()
              }}
              className="absolute left-2 sm:left-4 h-12 w-12 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Ảnh trước"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          {/* Image */}
          <div
            key={idx}



            className="max-w-[92vw] max-h-[82vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={images[idx]}
              alt={`Ảnh ${idx + 1}`}
              className="max-w-[92vw] max-h-[82vh] object-contain rounded-lg"
              loading="eager"
              decoding="async"
            />
          </div>

          {/* Next arrow */}
          {images.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                goNext()
              }}
              className="absolute right-2 sm:right-4 h-12 w-12 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Ảnh sau"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          {/* Thumbnail strip */}
          {images.length > 1 && (
            <div className="absolute bottom-3 inset-x-0 flex justify-center gap-2 px-4">
              {images.map((src, i) => (
                <button
                  key={i}
                  onClick={(e) => {
                    e.stopPropagation()
                    setIdx(i)
                  }}
                  className={`h-14 w-14 rounded-md overflow-hidden ring-2 transition-all ${i === idx ? 'ring-white scale-105' : 'ring-white/20 opacity-70 hover:opacity-100'
                    }`}
                  aria-label={`Ảnh ${i + 1}`}
                >
                  <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
