'use client'

/**
 * Admin — users panel (`/admin/users`).
 *
 * Role management for the three-role model (user / employee / admin).
 * Admin-only page: the backend enforces `admin:users:manage-roles` on
 * the PATCH endpoint; employees can't even see the nav entry.
 *
 * Server-side pagination on the shared TanStack Table DataTable (same
 * pattern as the tickets / vehicle-types panels). The role column is
 * a compact dropdown-per-row; changing a role updates the row in place
 * with optimistic feedback via toast.
 */

import { useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Bot, Loader2, RefreshCw, ShieldCheck, User as UserIcon, Users } from 'lucide-react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFeatures,
} from '@/components/data-table'
import { useApp } from '@/lib/store'
import { useSetUserRole, useUsers } from '@/lib/queries'
import type { UserOut } from '@/lib/api/types.gen'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 20

const ROLES: { value: string; label: string; hint: string }[] = [
  { value: 'user', label: 'Khách hàng', hint: 'Đặt vé, phản hồi, tra cứu vé' },
  { value: 'employee', label: 'Nhân viên', hint: 'Hỗ trợ chat, gọi điện, vé, khuyến mãi' },
  { value: 'admin', label: 'Quản trị', hint: 'Toàn quyền hệ thống' },
]

const ROLE_BADGE: Record<string, string> = {
  user: 'bg-slate-100 text-slate-700 border-slate-200',
  employee: 'bg-blue-100 text-blue-700 border-blue-200',
  admin: 'bg-amber-100 text-amber-800 border-amber-300',
}

const columnHelper = createColumnHelper<DataTableFeatures, UserOut>()

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

export function UsersPanel() {
  const { user: me } = useApp()
  const [page, setPage] = useState(0)

  const query = useUsers({ limit: PAGE_SIZE, offset: page * PAGE_SIZE })
  const roleMutation = useSetUserRole()

  const items = (query.data?.items ?? []) as UserOut[]
  const total = query.data?.total ?? 0

  const onRoleChange = async (target: UserOut, role: string) => {
    if (role === target.role) return
    try {
      await roleMutation.mutateAsync({
        path: { id: target.id },
        body: { role },
      })
      toast.success(`Đã cập nhật vai trò của «${target.fullName}»`)
    } catch (e: any) {
      toast.error(e?.error?.message ?? e?.body?.message ?? 'Không thể cập nhật vai trò')
      // Refetch in case the optimistic select left a stale value.
      void query.refetch()
    }
  }

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('fullName', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Người dùng" />,
          cell: ({ row }) => {
            const u = row.original
            return (
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-[11px] font-semibold bg-primary/10 text-primary">
                    {u.isBot ? <Bot className="h-4 w-4" aria-hidden /> : initials(u.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-medium truncate">
                    <span className="truncate">{u.fullName}</span>
                    {u.isBot && (
                      <Badge className="text-[9px] px-1 py-0 border-violet-200 bg-violet-50 text-violet-700">
                        BOT
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{u.email ?? '—'}</p>
                </div>
              </div>
            )
          },
          meta: { label: 'Người dùng' },
        }),
        columnHelper.accessor('role', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Vai trò" />,
          cell: ({ row }) => {
            const u = row.original
            const isSelf = me?.id === u.id
            const disabled =
              roleMutation.isPending || u.isBot || isSelf || me?.type !== 'admin'
            return (
              <div className="flex items-center gap-2">
                <Badge
                  className={cn(
                    'text-[10px] border font-medium whitespace-nowrap',
                    ROLE_BADGE[u.role] ?? ROLE_BADGE.user,
                  )}
                >
                  {ROLES.find((r) => r.value === u.role)?.label ?? u.role}
                </Badge>
                {me?.type === 'admin' && !u.isBot && !isSelf && (
                  <Select
                    value={u.role}
                    disabled={disabled}
                    onValueChange={(v) => void onRoleChange(u, v)}
                  >
                    <SelectTrigger
                      className="h-7 w-[130px] text-xs"
                      aria-label={`Đổi vai trò của ${u.fullName}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem
                          key={r.value}
                          value={r.value}
                          disabled={r.value === 'admin' && isSelf}
                          className="text-xs"
                        >
                          {r.label}
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            — {r.hint}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )
          },
          sortFn: 'basic',
          meta: { label: 'Vai trò' },
        }),
        columnHelper.accessor('status', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Trạng thái" />,
          cell: ({ getValue }) => {
            const v = getValue()
            return (
              <Badge
                className={cn(
                  'text-[10px] border',
                  v === 'active'
                    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                    : 'bg-rose-100 text-rose-700 border-rose-200',
                )}
              >
                {v === 'active' ? 'Hoạt động' : 'Bị khoá'}
              </Badge>
            )
          },
          sortFn: 'basic',
          meta: { label: 'Trạng thái' },
        }),
        columnHelper.accessor('createdAt', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Ngày tạo" />,
          cell: ({ getValue }) => (
            <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
              {new Date(getValue()).toLocaleDateString('vi-VN')}
            </span>
          ),
          sortFn: 'alphanumeric',
          meta: { label: 'Ngày tạo' },
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me?.id, me?.type, roleMutation.isPending],
  )

  return (
    <div className="p-3 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-600" />
            Người dùng
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Quản lý vai trò: khách hàng đặt vé, nhân viên hỗ trợ chat/call, quản
            trị toàn quyền. Tài khoản đầu tiên của hệ thống là quản trị viên.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          aria-label="Làm mới"
        >
          {query.isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {me?.type === 'admin' ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span>
            Chỉ quản trị viên mới đổi được vai trò. Không thể hạ quyền quản trị
            của chính mình hoặc của quản trị viên cuối cùng.
          </span>
        </div>
      ) : null}

      {/* Table — the DataTable renders its own bordered surface. */}
      <DataTable
        columns={columns}
        data={items}
        testId="users-table"
        rowNoun="người dùng"
        manualPagination
        totalRowCount={total}
        pageIndex={page}
        onPageIndexChange={setPage}
        pageSize={PAGE_SIZE}
        hidePaginationOnSinglePage={false}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle="Chưa có người dùng nào"
        emptyDescription="Tài khoản sẽ xuất hiện ở đây khi có người đăng ký."
        emptyIcon={<UserIcon className="h-5 w-5" aria-hidden />}
      />
    </div>
  )
}
