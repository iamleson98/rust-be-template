import type { RowData, ReactTable } from '@tanstack/react-table'
import { Settings2 } from 'lucide-react'

import { Button } from '@spa/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@spa/components/ui/dropdown-menu'

import { useT } from '@spa/lib/i18n'

import type { DataTableColumnMeta, DataTableFeatures } from './data-table-features'

export function DataTableViewOptions<TData extends RowData>({
  table,
  className,
}: {
  table: ReactTable<DataTableFeatures, TData>
  className?: string
}) {
  const t = useT()
  const hideableColumns = table.getAllColumns().filter((column) => column.getCanHide())

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
        {/* A group label needs its group (Base UI throws without one); it also names the list. */}
        <DropdownMenuGroup>
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
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
