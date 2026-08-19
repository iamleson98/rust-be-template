/** Admin route — `/admin/feedback` — feedback management page. */
import { AdminShell } from '@/components/layout/admin-shell'
import { Card, CardContent } from '@/components/ui/card'
import { MessageSquare } from 'lucide-react'

export function AdminFeedbackPage() {
  return (
    <AdminShell>
      <div className="container mx-auto px-4 py-6">
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>Chức năng quản lý phản hồi đang được phát triển.</p>
            <p className="text-xs mt-2">Vui lòng sử dụng tab Đánh giá để kiểm duyệt review.</p>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  )
}
