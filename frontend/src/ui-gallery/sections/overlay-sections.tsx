import { useState } from 'react'
import { ClipboardIcon, CreditCardIcon, Trash2Icon, UserIcon } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { Mirror, Section } from '../section'

/**
 * Overlay base components: Dialog, AlertDialog, Sheet, Drawer,
 * DropdownMenu, Popover, Tooltip, HoverCard, ContextMenu.
 */
export function OverlaySections() {
  const [dialogResult, setDialogResult] = useState('closed')
  const [deleteResult, setDeleteResult] = useState('untouched')
  const [dropdownAction, setDropdownAction] = useState('none')
  const [showHidden, setShowHidden] = useState(false)
  const [contextAction, setContextAction] = useState('none')

  return (
    <>
      <Section
        id="dialog"
        title="Dialog"
        description="Modal with overlay, focus trap, Escape + explicit close."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button data-testid="dialog-trigger">Book this trip</Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-content">
              <DialogHeader>
                <DialogTitle>Confirm your booking</DialogTitle>
                <DialogDescription>
                  Seat 12A · Hà Nội → Huế · 350,000₫
                </DialogDescription>
              </DialogHeader>
              <div className="text-sm">
                This action will hold your seat for 10 minutes.
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" data-testid="dialog-cancel">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  data-testid="dialog-confirm"
                  onClick={() => setDialogResult('booked')}
                >
                  Confirm seat hold
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <span className="text-sm">
            Result: <Mirror testId="dialog-mirror">{dialogResult}</Mirror>
          </span>
        </div>
      </Section>

      <Section
        id="alert-dialog"
        title="AlertDialog"
        description="Destructive confirmation with distinct cancel/action buttons."
      >
        <div className="flex flex-wrap items-center gap-3">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" data-testid="alert-dialog-trigger">
                Delete account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent data-testid="alert-dialog-content">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Are you sure you want to delete your account?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. All bookings and saved routes
                  will be permanently removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="alert-dialog-cancel">
                  Keep my account
                </AlertDialogCancel>
                <AlertDialogAction
                  data-testid="alert-dialog-action"
                  onClick={() => setDeleteResult('deleted')}
                >
                  Yes, delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <span className="text-sm">
            Result: <Mirror testId="alert-dialog-mirror">{deleteResult}</Mirror>
          </span>
        </div>
      </Section>

      <Section
        id="sheet"
        title="Sheet"
        description="Side panel for navigation / detail drawers."
      >
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" data-testid="sheet-trigger">
              Open route details
            </Button>
          </SheetTrigger>
          <SheetContent side="right" data-testid="sheet-content">
            <SheetHeader>
              <SheetTitle>Hà Nội → Huế express</SheetTitle>
              <SheetDescription>
                Departs 06:00 from Mỹ Đình station
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 text-sm">
              <p>2 rest stops · Wi-Fi onboard · 22 seats</p>
            </div>
          </SheetContent>
        </Sheet>
      </Section>

      <Section
        id="drawer"
        title="Drawer"
        description="Bottom sheet (vaul) — mobile-optimised panel."
      >
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline" data-testid="drawer-trigger">
              Open filter drawer
            </Button>
          </DrawerTrigger>
          <DrawerContent data-testid="drawer-content">
            <DrawerHeader>
              <DrawerTitle>Filter trips</DrawerTitle>
              <DrawerDescription>
                Narrow down by departure time or price.
              </DrawerDescription>
            </DrawerHeader>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button data-testid="drawer-close">Apply filters</Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </Section>

      <Section
        id="dropdown-menu"
        title="DropdownMenu"
        description="Action menus, checkbox items, and submenus."
      >
        <div className="flex flex-wrap items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" data-testid="dropdown-trigger" />
              }
            >
              Trip options
            </DropdownMenuTrigger>
            <DropdownMenuContent data-testid="dropdown-content">
              <DropdownMenuGroup>
                <DropdownMenuLabel>My account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="dropdown-profile"
                  onClick={() => setDropdownAction('profile')}
                >
                  <UserIcon />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="dropdown-billing"
                  onClick={() => setDropdownAction('billing')}
                >
                  <CreditCardIcon />
                  Billing
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-testid="dropdown-sub-trigger">
                  More actions
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    data-testid="dropdown-import"
                    onClick={() => setDropdownAction('import')}
                  >
                    Import bookings
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid="dropdown-export"
                    onClick={() => setDropdownAction('export')}
                  >
                    Export CSV
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={showHidden}
                onCheckedChange={(v) => setShowHidden(v === true)}
                closeOnClick={false}
                data-testid="dropdown-checkbox"
              >
                Show hidden items
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDropdownAction('deleted')}
              >
                <Trash2Icon />
                Delete trip
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="text-sm">
            Action:{' '}
            <Mirror testId="dropdown-mirror">{dropdownAction}</Mirror>
            {' · '}
            Hidden items:{' '}
            <Mirror testId="dropdown-hidden-mirror">
              {showHidden ? 'shown' : 'hidden'}
            </Mirror>
          </span>
        </div>
      </Section>

      <Section
        id="popover"
        title="Popover"
        description="Anchored non-modal floating panel."
      >
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" data-testid="popover-trigger">
              Trip amenities
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64" data-testid="popover-content">
            <div className="grid gap-2">
              <p className="text-sm font-medium">Included in fare</p>
              <ul className="text-muted-foreground list-disc pl-4 text-sm">
                <li>Wi-Fi &amp; USB charging</li>
                <li>Bottled water</li>
                <li>2 rest stops</li>
              </ul>
            </div>
          </PopoverContent>
        </Popover>
      </Section>

      <Section
        id="tooltip"
        title="Tooltip"
        description="Hover hint with delayed show."
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" data-testid="tooltip-trigger">
              Hold my seat
            </Button>
          </TooltipTrigger>
          <TooltipContent data-testid="tooltip-content">
            Seats are held for 10 minutes
          </TooltipContent>
        </Tooltip>
      </Section>

      <Section id="hover-card" title="HoverCard" description="Rich hover preview.">
        <HoverCard>
          <HoverCardTrigger asChild>
            <a
              href="#sec-hover-card"
              className="text-primary font-medium underline underline-offset-4"
              data-testid="hover-card-trigger"
            >
              @datxevui
            </a>
          </HoverCardTrigger>
          <HoverCardContent className="w-64" data-testid="hover-card-content">
            <div className="flex gap-2">
              <div className="bg-primary/10 flex size-10 shrink-0 items-center justify-center rounded-full text-primary">
                VX
              </div>
              <div className="grid gap-0.5">
                <p className="text-sm font-medium">DatXeVui Support</p>
                <p className="text-muted-foreground text-xs">
                  Official account · replies in ~2 min
                </p>
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
      </Section>

      <Section
        id="context-menu"
        title="ContextMenu"
        description="Right-click menu over a target area."
      >
        <div className="flex flex-wrap items-center gap-4">
          <ContextMenu>
            <ContextMenuTrigger
              render={
                <div
                  data-testid="context-zone"
                  className="border-border text-muted-foreground grid h-24 w-64 place-items-center rounded-md border-2 border-dashed text-sm"
                />
              }
            >
              <span className="p-4">Right-click this area</span>
            </ContextMenuTrigger>
            <ContextMenuContent data-testid="context-content">
              <ContextMenuItem
                data-testid="context-copy"
                onClick={() => setContextAction('copied')}
              >
                <ClipboardIcon />
                Copy booking code
              </ContextMenuItem>
              <ContextMenuItem
                data-testid="context-share"
                onClick={() => setContextAction('shared')}
              >
                Share trip link
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() => setContextAction('cancelled')}
              >
                Cancel booking
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <span className="text-sm">
            Action: <Mirror testId="context-mirror">{contextAction}</Mirror>
          </span>
        </div>
      </Section>
    </>
  )
}
