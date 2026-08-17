/** Admin route — `/admin/feedback` — feedback management page. */
import { Card, CardContent } from '@/components/ui/card'
import { MessageSquare } from 'lucide-react'

export function AdminFeedbackPage() {
  // TODO: When a dedicated /api/admin/feedback endpoint exists,
  // wire it here. For now we show a placeholder that doesn't invent data.
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="container mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Phản hồi khách hàng</h1>
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Chức năng quản lý phản hồi đang được phát triển.</p>
            <p className="text-xs mt-2">Vui lòng sử dụng tab Đánh giá để kiểm duyệt review.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
