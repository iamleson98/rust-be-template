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

import { setUserRoleMutation, listUsersOptions } from '@/api'
import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query'
import { useSession } from '@/stores/session'
import { useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Bot, RefreshCw, ShieldCheck, User as UserIcon } from 'lucide-react'
import { toast } from 'sonner'

import { ConsolePage, PageHeader } from '@/components/console/page'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ComboboxField } from '@/components/ui/combobox'

import { DataTable, DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'
import type { UserOut } from '@/api'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/error-message'
import { useT } from '@/lib/i18n'

const PAGE_SIZE = 20

const ROLES: { value: string; labelKey: string }[] = [
  { value: 'user', labelKey: 'users.roleUser' },
  { value: 'employee', labelKey: 'users.roleEmployee' },
  { value: 'admin', labelKey: 'users.roleAdmin' },
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
  const me = useSession((s) => s.user)
  const t = useT()
  const [page, setPage] = useState(0)

  const query = useQuery({
    ...listUsersOptions({ query: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  })
  const roleMutation = useMutation(setUserRoleMutation())

  const items = (query.data?.items ?? []) as UserOut[]
  const total = query.data?.total ?? 0

  const onRoleChange = async (target: UserOut, role: string) => {
    if (role === target.role) return
    try {
      await roleMutation.mutateAsync({
        path: { id: target.id },
        body: { role },
      })
      toast.success(t('adminUsers.roleChangedOf', { name: target.fullName }))
    } catch (e) {
      toast.error(
        e instanceof Error || (e && typeof e === 'object' && ('error' in e || 'body' in e))
          ? getErrorMessage(e)
          : t('adminUsers.roleChangeFailed'),
      )
      // Refetch in case the optimistic select left a stale value.
      void query.refetch()
    }
  }

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('fullName', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title={t('admin.users')} />
          ),
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
                      <Badge className="text-[10px] px-1 py-0 border-violet-200 bg-violet-50 text-violet-700">
                        BOT
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{u.email ?? '—'}</p>
                </div>
              </div>
            )
          },
          meta: { label: t('admin.users') },
        }),
        columnHelper.accessor('role', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title={t('adminUsers.role')} />
          ),
          cell: ({ row }) => {
            const u = row.original
            const isSelf = me?.id === u.id
            const disabled = roleMutation.isPending || u.isBot || isSelf || me?.type !== 'admin'
            const roleDef = ROLES.find((r) => r.value === u.role)
            // Editable rows show just the picker (it already shows the role).
            return me?.type === 'admin' && !u.isBot && !isSelf ? (
              <ComboboxField
                value={u.role}
                disabled={disabled}
                onValueChange={(v) => void onRoleChange(u, v)}
                items={ROLES.map((r) => ({ value: r.value, label: t(r.labelKey) }))}
                className="h-8 w-36 text-xs"
                placeholder={t('adminUsers.role')}
                searchPlaceholder={t('combobox.search')}
                aria-label={t('users.changeRoleOf', { name: u.fullName })}
              />
            ) : (
              <Badge
                className={cn(
                  'border text-[10px] font-medium whitespace-nowrap',
                  ROLE_BADGE[u.role] ?? ROLE_BADGE.user,
                )}
              >
                {roleDef ? t(roleDef.labelKey) : u.role}
              </Badge>
            )
          },
          sortFn: 'basic',
          meta: { label: t('adminUsers.role') },
        }),
        columnHelper.accessor('status', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title={t('common.status')} />
          ),
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
                {v === 'active' ? t('common.active') : t('adminUsers.locked')}
              </Badge>
            )
          },
          sortFn: 'basic',
          meta: { label: t('common.status') },
        }),
        columnHelper.accessor('createdAt', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title={t('adminUsers.createdAt')} />
          ),
          cell: ({ getValue }) => (
            <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
              {new Date(getValue()).toLocaleDateString('vi-VN')}
            </span>
          ),
          sortFn: 'alphanumeric',
          meta: { label: t('adminUsers.createdAt') },
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me?.id, me?.type, roleMutation.isPending, t],
  )

  return (
    <ConsolePage>
      <PageHeader
        title={t('admin.users')}
        description={t('adminUsers.subtitle')}
        actions={
          <Button
            variant="outline"
            size="icon"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            aria-label={t('common.refresh')}
          >
            <RefreshCw className={query.isFetching ? 'animate-spin' : undefined} />
          </Button>
        }
      />

      {me?.type === 'admin' ? (
        <Alert variant="warning">
          <ShieldCheck />
          <AlertDescription>{t('adminUsers.adminNote')}</AlertDescription>
        </Alert>
      ) : null}

      {/* Table — the DataTable renders its own bordered surface. */}
      <DataTable
        columns={columns}
        data={items}
        testId="users-table"
        rowNoun={t('adminUsers.rowNoun')}
        manualPagination
        totalRowCount={total}
        pageIndex={page}
        onPageIndexChange={setPage}
        pageSize={PAGE_SIZE}
        hidePaginationOnSinglePage={false}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle={t('adminUsers.emptyTitle')}
        emptyDescription={t('adminUsers.emptyDesc')}
        emptyIcon={<UserIcon className="h-5 w-5" aria-hidden />}
      />
    </ConsolePage>
  )
}
