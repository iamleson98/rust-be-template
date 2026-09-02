import { useState } from 'react'
import { CalendarIcon, UserIcon, CreditCardIcon } from 'lucide-react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@/components/ui/menubar'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { Mirror, Section } from '../section'

const REVIEWS = [
  'Phương Trang — "Great sleep bus, on time"',
  'Thanh Bình — "Clean, helpful driver"',
  'Hoàng Long — "Cheapest fare for the route"',
  'Mai Linh — "Comfortable limousine seats"',
  'Kumho — "Smooth ride, good AC"',
  'Bedrooms — "Blanket and pillow included"',
  'Le Anh — "Two stops, both clean"',
  'Trọng Thủy — "Wi-Fi worked the whole way"',
  'Sao Việt — "Would book again"',
  'G5 Transport — "Fast booking via app"',
  'Hà Sơn — "Good value for money"',
  'Việt Thanh — "Luggage handled with care"',
]

/**
 * Navigation base components: Tabs, Accordion, Collapsible,
 * ScrollArea, Resizable, Menubar, NavigationMenu.
 */
export function NavigationSections() {
  const [tab, setTab] = useState('account')
  const [collapsibleOpen, setCollapsibleOpen] = useState(false)
  const [menubarAction, setMenubarAction] = useState('none')
  const [menubarChecked, setMenubarChecked] = useState(false)

  return (
    <>
      <Section
        id="tabs"
        title="Tabs"
        description="Tab list with panels + keyboard arrow navigation."
      >
        <Tabs value={tab} onValueChange={setTab} data-testid="tabs-demo">
          <TabsList data-testid="tabs-list">
            <TabsTrigger value="account" data-testid="tab-trigger-account">
              Account
            </TabsTrigger>
            <TabsTrigger value="password" data-testid="tab-trigger-password">
              Password
            </TabsTrigger>
            <TabsTrigger value="billing" data-testid="tab-trigger-billing">
              Billing
            </TabsTrigger>
          </TabsList>
          <TabsContent value="account" data-testid="tabs-panel-account">
            <div className="border rounded-md p-4 text-sm">
              Account settings — email, phone, and language.
            </div>
          </TabsContent>
          <TabsContent value="password" data-testid="tabs-panel-password">
            <div className="border rounded-md p-4 text-sm">
              Change password — current, new, confirm.
            </div>
          </TabsContent>
          <TabsContent value="billing" data-testid="tabs-panel-billing">
            <div className="border rounded-md p-4 text-sm">
              Payment methods — MoMo, VNPay, ZaloPay.
            </div>
          </TabsContent>
        </Tabs>
        <p className="text-sm">
          Active tab: <Mirror testId="tabs-mirror">{tab}</Mirror>
        </p>
      </Section>

      <Section
        id="accordion"
        title="Accordion"
        description="Collapsible stacked sections (FAQ pattern)."
      >
        <Accordion
          type="single"
          defaultValue="item-1"
          data-testid="accordion-demo"
          className="w-full"
        >
          <AccordionItem value="item-1">
            <AccordionTrigger data-testid="accordion-trigger-1">
              Can I cancel my ticket?
            </AccordionTrigger>
            <AccordionContent data-testid="accordion-content-1">
              Yes — over 24h before departure you get a 90% refund, over 4h a
              50% refund.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger data-testid="accordion-trigger-2">
              How long are seats held?
            </AccordionTrigger>
            <AccordionContent data-testid="accordion-content-2">
              Seats are held for 10 minutes after you start the booking.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-3">
            <AccordionTrigger data-testid="accordion-trigger-3">
              Do you support COD?
            </AccordionTrigger>
            <AccordionContent data-testid="accordion-content-3">
              Yes — pay the driver in cash when boarding.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Section>

      <Section
        id="collapsible"
        title="Collapsible"
        description="Single expand/collapse block."
      >
        <Collapsible
          open={collapsibleOpen}
          onOpenChange={setCollapsibleOpen}
          data-testid="collapsible-demo"
        >
          <CollapsibleTrigger
            className="border rounded-md px-3 py-1.5 text-sm font-medium"
            data-testid="collapsible-trigger"
          >
            Refund policy
          </CollapsibleTrigger>
          <CollapsibleContent data-testid="collapsible-content">
            <p className="text-muted-foreground border rounded-md p-4 text-sm">
              Refunds are processed to the original payment method within 3–5
              business days.
            </p>
          </CollapsibleContent>
        </Collapsible>
        <p className="text-sm">
          Open: <Mirror testId="collapsible-mirror">{String(collapsibleOpen)}</Mirror>
        </p>
      </Section>

      <Section
        id="scroll-area"
        title="ScrollArea"
        description="Custom-styled scroll container (chat + list views)."
      >
        <ScrollArea
          className="border rounded-md p-4 h-40 w-full max-w-md"
          data-testid="scroll-area-demo"
        >
          <div className="space-y-2">
            {REVIEWS.map((r) => (
              <div key={r} className="text-sm">
                {r}
              </div>
            ))}
          </div>
        </ScrollArea>
      </Section>

      <Section
        id="resizable"
        title="Resizable"
        description="Draggable panel split (layout building block)."
      >
        <ResizablePanelGroup
          direction="horizontal"
          className="border rounded-md min-h-32 max-w-2xl"
          data-testid="resizable-demo"
        >
          <ResizablePanel defaultSize={50} minSize={20}>
            <div className="flex h-full items-center justify-center p-4">
              <p className="text-muted-foreground text-sm">Seat map</p>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle data-testid="resizable-handle" />
          <ResizablePanel defaultSize={50} minSize={20}>
            <div className="flex h-full items-center justify-center p-4">
              <p className="text-muted-foreground text-sm">Trip details</p>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </Section>

      <Section id="menubar" title="Menubar" description="Top-level menu bar (desktop app pattern).">
        <div className="flex flex-wrap items-center gap-4">
          <Menubar data-testid="menubar-demo">
            <MenubarMenu>
              <MenubarTrigger data-testid="menubar-file-trigger">
                File
              </MenubarTrigger>
              <MenubarContent data-testid="menubar-file-content">
                <MenubarItem
                  data-testid="menubar-new"
                  onClick={() => setMenubarAction('new-booking')}
                >
                  New booking
                  <MenubarShortcut>⌘N</MenubarShortcut>
                </MenubarItem>
                <MenubarItem
                  data-testid="menubar-export"
                  onClick={() => setMenubarAction('export')}
                >
                  Export CSV
                </MenubarItem>
                <MenubarSeparator />
                <MenubarCheckboxItem
                  checked={menubarChecked}
                  onCheckedChange={(v) => setMenubarChecked(v === true)}
                  closeOnClick={false}
                  data-testid="menubar-checkbox"
                >
                  Show stats
                </MenubarCheckboxItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger data-testid="menubar-edit-trigger">
                Edit
              </MenubarTrigger>
              <MenubarContent>
                <MenubarItem onClick={() => setMenubarAction('undo')}>
                  Undo
                  <MenubarShortcut>⌘Z</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onClick={() => setMenubarAction('redo')}>
                  Redo
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
          <span className="text-sm">
            Action: <Mirror testId="menubar-mirror">{menubarAction}</Mirror>
            {' · '}
            Stats: <Mirror testId="menubar-checked-mirror">
              {menubarChecked ? 'on' : 'off'}
            </Mirror>
          </span>
        </div>
      </Section>

      <Section
        id="navigation-menu"
        title="NavigationMenu"
        description="Horizontal site navigation with links."
      >
        <NavigationMenu data-testid="navigation-menu-demo">
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink
                className={navigationMenuTriggerStyle()}
                render={
                  <a href="#sec-navigation-menu" data-testid="nav-link-home" />
                }
              >
                Home
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink
                className={navigationMenuTriggerStyle()}
                render={
                  <a
                    href="#sec-navigation-menu"
                    data-testid="nav-link-search"
                  />
                }
              >
                Search trips
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink
                className={navigationMenuTriggerStyle()}
                render={
                  <a
                    href="#sec-navigation-menu"
                    data-testid="nav-link-support"
                  />
                }
              >
                Support
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </Section>
    </>
  )
}
