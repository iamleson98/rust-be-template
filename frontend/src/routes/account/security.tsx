'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ShieldCheck, Lock, Smartphone } from 'lucide-react'

export function AccountSecurityPage() {
  return (
    <div className="page-transition">
      <div className="container mx-auto px-4 py-6 max-w-4xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" /> Bảo mật tài khoản
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">Mật khẩu</div>
                  <div className="text-xs text-muted-foreground">Đổi mật khẩu định kỳ để bảo mật</div>
                </div>
              </div>
              <button className="text-xs text-primary font-medium hover:underline">
                Đổi mật khẩu
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">Xác thực 2 bước</div>
                  <div className="text-xs text-muted-foreground">Bảo vệ thêm bằng SMS hoặc app</div>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">Chưa bật</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quyền dữ liệu cá nhân</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Dữ liệu cá nhân của bạn được xử lý theo Nghị định 13/2023/NĐ-CP.
              Bạn có quyền yêu cầu truy cập, chỉnh sửa hoặc xoá dữ liệu bất cứ lúc nào.
              Chúng tôi không chia sẻ thông tin của bạn với bên thứ ba.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
