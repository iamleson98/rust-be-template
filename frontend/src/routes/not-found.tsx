/** 404 Not Found route */
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Compass } from 'lucide-react'
import { buildSearchInput } from '@/lib/search-params'

export function NotFoundPage() {
  return (
    <div className="container mx-auto px-4 py-20 max-w-xl text-center">
      <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 mb-6">
        <Compass className="h-8 w-8 text-blue-500" />
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight">404 — Không tìm thấy trang</h1>
      <p className="mt-3 text-muted-foreground">
        Trang bạn đang tìm có thể đã bị di chuyển, đổi tên hoặc tạm thời không khả dụng.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Button asChild>
          <Link to="/">Về trang chủ</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/search" search={buildSearchInput({ from: '', to: '', date: '' })}>
            Tìm chuyến xe
          </Link>
        </Button>
      </div>
    </div>
  )
}
