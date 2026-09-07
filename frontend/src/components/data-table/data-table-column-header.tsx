'use client'

/**
 * Sortable column header following the official shadcn data-table guide
 * (https://ui.shadcn.com/docs/components/base/data-table).
 *
 * ONE control per header — a single ghost button that toggles the sort
 * direction (asc → desc) with an animated direction indicator. There is
 * deliberately no second dropdown next to it: hiding columns stays in
 * the toolbar's `DataTableViewOptions` menu, so nothing about sorting is
 * ever duplicated in the header.
 */

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type { Column, RowData } from '@tanstack/react-table'

import { Button } from '@/components/ui/button'

import { cn } from '@/lib/utils'
import type { DataTableFeatures } from './data-table-features'

interface DataTableColumnHeaderProps<TData extends RowData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<DataTableFeatures, TData, TValue>
  title: string
}

export function DataTableColumnHeader<TData extends RowData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <span className={cn('text-inherit', className)}>{title}</span>
  }

  const sorted = column.getIsSorted()
  const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        '-ml-2.5 h-7 gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-current',
        className,
      )}
      onClick={() => column.toggleSorting(sorted === 'asc')}
      aria-label={`Sắp xếp theo ${title}`}
    >
      {title}
      <SortIcon
        className={cn(
          'size-3.5 shrink-0 transition-all duration-200',
          sorted ? 'text-primary' : 'text-muted-foreground/40',
        )}
        aria-hidden
      />
    </Button>
  )
}
