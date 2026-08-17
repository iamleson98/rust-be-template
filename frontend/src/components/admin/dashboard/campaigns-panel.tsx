'use client'

/**
 * CampaignsPanel — admin "Khuyến mãi" tab content.
 *
 * Migrated from receiving `campaigns` as a prop to fetching them directly
 * via the `useCampaigns()` TanStack Query hook. The hook is shared with
 * any other component that reads campaigns (e.g. the homepage Flash Sale
 * section) — TanStack Query deduplicates by queryKey, so mounting this
 * panel doesn't trigger a duplicate request.
 *
 * Loading / error / empty states are rendered inline (Vietnamese strings
 * + retry button) to keep UX consistent with the other admin tabs.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sparkles, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { formatNum } from '@/lib/types'
import { useCampaigns } from '@/lib/queries'
import type { AdminCampaignRow as Campaign } from './types'

export function CampaignsPanel() {
  const { data, isLoading, isError, error, refetch } = useCampaigns()
  const campaigns: Campaign[] = (data?.items ?? []) as unknown as Campaign[]

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Chiến dịch khuyến mãi đang chạy
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải chiến dịch khuyến mãi…
          </div>
        ) : isError ? (
          <div className="p-8 text-center">
            <AlertCircle className="h-10 w-10 text-rose-300 mx-auto mb-3" />
            <h3 className="font-semibold text-sm">Không tải được khuyến mãi</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {(error as Error)?.message ?? 'Đã có lỗi xảy ra. Vui lòng thử lại.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3 h-7 text-xs">
              Thử lại
            </Button>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-8 text-center">
            <Sparkles className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <h3 className="font-semibold text-sm">Chưa có chiến dịch khuyến mãi</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Các chương trình giảm giá đang chạy sẽ hiển thị tại đây.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left font-semibold p-3">Mã</th>
                  <th className="text-left font-semibold p-3">Tên</th>
                  <th className="text-left font-semibold p-3 hidden md:table-cell">Hãng</th>
                  <th className="text-right font-semibold p-3">Lượt dùng</th>
                  <th className="text-right font-semibold p-3 hidden sm:table-cell">Giới hạn</th>
                  <th className="text-center font-semibold p-3">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3"><code className="font-mono font-bold text-blue-700">{c.code}</code></td>
                    <td className="p-3 font-medium">{c.name}</td>
                    <td className="p-3 hidden md:table-cell text-muted-foreground">{c.brand?.name ?? 'Toàn nền tảng'}</td>
                    <td className="p-3 text-right font-medium">{formatNum(c.usedCount)}</td>
                    <td className="p-3 text-right hidden sm:table-cell text-muted-foreground">{c.usageLimitTotal > 0 ? formatNum(c.usageLimitTotal) : '∞'}</td>
                    <td className="p-3 text-center">
                      <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> {c.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
