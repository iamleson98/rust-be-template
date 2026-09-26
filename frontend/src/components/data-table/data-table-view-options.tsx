'use client'

/**
 * Column-visibility dropdown following the shadcn data-table guide's
 * `DataTableViewOptions`. Column labels come from `meta.label` (falling
 * back to the column id) so the menu stays Vietnamese.
 */

import type { RowData, ReactTable } from '@tanstack/react-table'
import { Settings2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { useT } from '@/lib/i18n'

import type { DataTableColumnMeta, DataTableFeatures } from './data-table-features'

export function DataTableViewOptions<TData extends RowData>({
  table,
  className,
}: {
  table: ReactTable<DataTableFeatures, TData>
  className?: string
}) {
  const t = useT()
  const hideableColumns = table
    .getAllColumns()
    .filter((column) => column.getCanHide())

  if (hideableColumns.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={className}
            aria-label={t('dataTable.toggleColumns')}
          />
        }
      >
        <Settings2 className="size-3.5" />
        {t('dataTable.columns')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t('dataTable.showColumns')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hideableColumns.map((column) => {
          const meta = column.columnDef.meta as DataTableColumnMeta | undefined
          return (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(value) => column.toggleVisibility(!!value)}
              className="cursor-pointer"
            >
              {meta?.label ?? column.id}
            </DropdownMenuCheckboxItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
