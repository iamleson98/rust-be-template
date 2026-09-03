'use client'

/**
 * Sortable + hideable column header, following the shadcn data-table
 * "Reusable Components" guide with one UX refinement: a single click on
 * the label toggles asc/desc immediately (the docs' dropdown remains
 * available through the small chevron for Asc/Desc/Hide actions).
 */

import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, EyeOff } from 'lucide-react'
import type { Column, RowData } from '@tanstack/react-table'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
  const canSort = column.getCanSort()
  const canHide = column.getCanHide()
  const sorted = column.getIsSorted()

  if (!canSort && !canHide) {
    return <span className={cn('text-[inherit]', className)}>{title}</span>
  }

  const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {canSort ? (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2.5 h-7 gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-current hover:text-current data-[state=open]:bg-accent"
          onClick={() => column.toggleSorting(sorted === 'asc')}
          aria-label={`Sắp xếp theo ${title}`}
        >
          {title}
          <SortIcon
            className={cn(
              'size-3.5 shrink-0',
              sorted ? 'text-muted-foreground' : 'text-muted-foreground/40',
            )}
          />
        </Button>
      ) : (
        <span className="-ml-2.5 px-2">{title}</span>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground/60 hover:text-muted-foreground"
              aria-label={`Tuỳ chọn cột ${title}`}
            />
          }
        >
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-36">
          {canSort ? (
            <>
              <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
                <ArrowUp className="size-3.5" /> Tăng dần
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
                <ArrowDown className="size-3.5" /> Giảm dần
              </DropdownMenuItem>
              {canHide ? <DropdownMenuSeparator /> : null}
            </>
          ) : null}
          {canHide ? (
            <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
              <EyeOff className="size-3.5" /> Ẩn cột này
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
