'use client'

import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import {
  useWishlist,
  useToggleWishlist,
  useRemoveWishlist,
  type WishlistItem,
} from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  Heart,
  X,
  Trash2,
  Bus,
  MapPin,
  Phone,
  Loader2,
  Search,
  Plus,
  LogIn,
} from 'lucide-react'
import { toast } from 'sonner'
import { relativeTime } from '@/lib/types'
import { NoWishlistItems } from './empty-states'
import { buildSearchInput } from '@/lib/search-params'

type Props = {
  /** Inline button variant for use in trip cards / search results header. */
  variant?: 'icon' | 'button'
  /** Optional preset data when adding from a trip card. */
  presetLabel?: string
  presetRouteId?: string
  presetBrandId?: string
}

// ────────────────────────────────────────────────────────────────────
// Wishlist cache (localStorage) — kept for fast optimistic UI on the
// header bell badge. The authoritative data lives in TanStack Query's
// `useWishlist` cache (key: ['wishlist']); this is a tiny "labels only"
// mirror so the bell can render the count badge before the network
// resolves on a cold load.
// ────────────────────────────────────────────────────────────────────
const CACHE_KEY = 'bus_wishlist_cache'

function loadCacheCount(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw).length : 0
  } catch {
    return 0
  }
}

function saveCacheLabels(labels: string[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(labels))
  } catch {
    // ignore
  }
}

export function WishlistButton({ variant = 'icon', presetLabel, presetRouteId, presetBrandId }: Props) {
  const { user, wishlistOpen, setWishlistOpen } = useApp()
  const navigate = useNavigate()

  const isLoggedIn = !!user

  // ── Data: TanStack Query ─────────────────────────────────────────
  // Only fetch when the user is authenticated — the hook's `enabled`
  // flag short-circuits the query for guests (no 401s in the console).
  const { data, isLoading, refetch } = useWishlist({ enabled: isLoggedIn })
  const items: WishlistItem[] = data?.items ?? []

  const toggleMutation = useToggleWishlist()
  const removeMutation = useRemoveWishlist()

  const addToWishlist = async () => {
    if (!isLoggedIn) {
      toast.info('Đăng nhập để lưu tuyến yêu thích')
      navigate({ to: '/login' })
      return
    }
    if (!presetLabel) {
      setWishlistOpen(true)
      return
    }
    // presetLabel has the shape "From → To" — split it back into the
    // separate legs the API expects.
    const [fromName, toName] = presetLabel.split(' → ').map((s) => s.trim())
    try {
      await toggleMutation.mutateAsync({
        routeId: presetRouteId,
        tripId: undefined,
        fromName: fromName ?? presetLabel,
        toName: toName ?? '',
      })
      toast.success('Đã lưu vào yêu thích')
    } catch {
      // The mutation hook already invalidates the wishlist query on
      // success; on error we surface a friendly toast and let the
      // user retry.
      toast.error('Không thể lưu')
    }
  }

  const removeItem = async (id: string) => {
    try {
      await removeMutation.mutateAsync(id)
      toast.success('Đã xoá khỏi yêu thích')
      // Refresh the local label cache so the bell badge count stays in sync
      saveCacheLabels(items.filter((i) => i.id !== id).map((i) => `${i.fromName} → ${i.toName}`))
    } catch {
      toast.error('Không thể xoá')
    }
  }

  // ─── Variant: header icon button ───
  if (variant === 'icon') {
    // If not logged in, show a "login to save" tooltip-style button that
    // redirects to the login route on click.
    if (!isLoggedIn) {
      return (
        <button
          onClick={() => {
            toast.info('Đăng nhập để lưu tuyến yêu thích')
            navigate({ to: '/login' })
          }}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-blue-100 hover:bg-white/10 hover:text-rose-300 transition-colors"
          aria-label="Đăng nhập để lưu yêu thích"
          title="Đăng nhập để lưu"
        >
          <Heart className="h-4 w-4" />
        </button>
      )
    }
    // Logged in: show bell with count badge. Hide on mobile if 0 to save space.
    // Use the live query count; fall back to the cached count during the
    // very first paint before the query resolves.
    const count = items.length || (isLoading ? loadCacheCount() : 0)
    // Persist label cache whenever items change so the next mount can show
    // an accurate badge instantly.
    if (items.length > 0) {
      saveCacheLabels(items.map((i) => `${i.fromName} → ${i.toName}`))
    }
    return (
      <>
        <button
          onClick={() => {
            setWishlistOpen(true)
            refetch()
          }}
          className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full text-blue-100 hover:bg-white/10 hover:text-rose-300 transition-colors ${count === 0 ? 'hidden sm:inline-flex' : ''
            }`}
          aria-label="Tuyến yêu thích"
          title="Tuyến yêu thích"
        >
          <Heart className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute top-1 right-1 min-w-4 h-4 px-1 inline-flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold ring-2 ring-white">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </button>

        <WishlistPanel
          open={wishlistOpen}
          onClose={() => setWishlistOpen(false)}
          items={items}
          loading={isLoading}
          onRemove={removeItem}
        />
      </>
    )
  }

  // ─── Variant: button in trip cards ───
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={addToWishlist}
        disabled={toggleMutation.isPending}
        className="gap-1.5 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50"
      >
        {toggleMutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : !isLoggedIn ? (
          <LogIn className="h-3.5 w-3.5" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        {isLoggedIn ? 'Lưu yêu thích' : 'Đăng nhập để lưu'}
      </Button>
      <WishlistPanel
        open={wishlistOpen}
        onClose={() => setWishlistOpen(false)}
        items={items}
        loading={isLoading}
        onRemove={removeItem}
      />
    </>
  )
}

function WishlistPanel({
  open,
  onClose,
  items,
  loading,
  onRemove,
}: {
  open: boolean
  onClose: () => void
  items: WishlistItem[]
  loading: boolean
  onRemove: (id: string) => void
}) {
  const { user } = useApp()
  const navigate = useNavigate()

  return (
    <>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
          <div className="fixed left-2 sm:left-4 top-16 z-50 w-[calc(100vw-1rem)] sm:w-100 max-h-[80vh] bg-white rounded-2xl ring-1 ring-black/10 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-linear-to-r from-rose-50 to-pink-50">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-linear-to-br from-rose-500 to-pink-500 text-white inline-flex items-center justify-center">
                  <Heart className="h-4 w-4 fill-white" />
                </div>
                <div>
                  <div className="font-semibold text-sm">Tuyến yêu thích</div>
                  <div className="text-[10px] text-muted-foreground">{items.length} mục đã lưu</div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-slate-200 text-muted-foreground"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* List */}
            <ScrollArea className="flex-1 max-h-[60vh]">
              {loading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Đang tải...</div>
              ) : items.length === 0 ? (
                <div className="p-4">
                  <NoWishlistItems
                    onExplore={() => {
                      navigate({ to: '/' })
                      onClose()
                    }}
                  />
                </div>
              ) : (
                <div className="divide-y">
                  {items.map((it) => {
                    return (
                      <div key={it.id} className="px-4 py-3 hover:bg-slate-50 transition-colors group">
                        <div className="flex items-start gap-3">
                          <div className="h-9 w-9 shrink-0 rounded-lg bg-linear-to-br from-rose-100 to-pink-100 text-rose-700 inline-flex items-center justify-center">
                            <Bus className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm flex items-center gap-1.5 flex-wrap">
                              <span>{it.fromName}</span>
                              <MapPin className="h-3 w-3 text-rose-500" />
                              <span>{it.toName}</span>
                            </div>
                            {it.brandName && (
                              <div className="text-xs text-muted-foreground mt-0.5">{it.brandName}</div>
                            )}
                            <div className="text-[10px] text-muted-foreground mt-1">
                              Đã lưu {relativeTime(it.createdAt)}
                            </div>
                          </div>
                          <button
                            onClick={() => onRemove(it.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-rose-100 text-rose-600"
                            aria-label="Xoá"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 h-7 gap-1 text-xs text-blue-700 hover:text-blue-800 hover:bg-blue-50"
                          onClick={() => {
                            navigate({
                              to: '/search',
                              search: buildSearchInput({ from: it.fromName, to: it.toName }),
                            })
                            onClose()
                          }}
                        >
                          <Search className="h-3 w-3" />
                          Tìm chuyến đi
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </ScrollArea>

            {/* Footer */}
            <div className="border-t px-4 py-2 flex items-center justify-between bg-slate-50">
              <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {user?.phone ?? user?.email ?? '—'}
              </div>
              <Badge variant="outline" className="text-[10px] font-normal">
                Đồng bộ máy chủ
              </Badge>
            </div>
          </div>
        </>
      )}
    </>
  )
}
