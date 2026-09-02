import { InfoIcon, TriangleAlertIcon } from 'lucide-react'

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { AspectRatio } from '@/components/ui/aspect-ratio'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'

import { Row, Section } from '../section'

/**
 * Static (non-interactive) base components: Badge, Alert, Card,
 * Skeleton, Progress, Avatar, Separator, Table, Breadcrumb,
 * AspectRatio, Pagination.
 */
export function StaticSections() {
  return (
    <>
      <Section
        id="badge"
        title="Badge"
        description="Small status descriptors — 4 variants."
      >
        <Row>
          <Badge data-testid="badge-default">Default</Badge>
          <Badge variant="secondary" data-testid="badge-secondary">
            Secondary
          </Badge>
          <Badge variant="destructive" data-testid="badge-destructive">
            Destructive
          </Badge>
          <Badge variant="outline" data-testid="badge-outline">
            Outline
          </Badge>
        </Row>
      </Section>

      <Section
        id="alert"
        title="Alert"
        description="Callout blocks for important messages."
      >
        <div className="space-y-3">
          <Alert data-testid="alert-default">
            <InfoIcon />
            <AlertTitle>Heads up!</AlertTitle>
            <AlertDescription>
              You can add components to your app using the CLI.
            </AlertDescription>
          </Alert>
          <Alert variant="destructive" data-testid="alert-destructive">
            <TriangleAlertIcon />
            <AlertTitle>Payment failed</AlertTitle>
            <AlertDescription>
              Your card was declined. Please try another method.
            </AlertDescription>
          </Alert>
        </div>
      </Section>

      <Section
        id="card"
        title="Card"
        description="The workhorse container for dashboard + list views."
      >
        <Card className="max-w-md" data-testid="card-demo">
          <CardHeader>
            <CardTitle>Ho Chi Minh City → Da Lat</CardTitle>
            <CardDescription>
              Limousine 22 seats · 7h 30m · free water
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <p className="text-sm">Departure 08:30 · Arrival 16:00</p>
            <p className="text-2xl font-bold">380,000₫</p>
          </CardContent>
          <CardFooter className="gap-2">
            <Button data-testid="card-book-btn">Book now</Button>
            <Button variant="outline">Details</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section id="skeleton" title="Skeleton" description="Loading placeholders.">
        <div className="flex w-full max-w-md flex-col gap-2" data-testid="skeleton-group">
          <Skeleton className="h-4 w-3/4" data-testid="skeleton-line-1" />
          <Skeleton className="h-4 w-full" data-testid="skeleton-line-2" />
          <Skeleton className="h-4 w-2/3" data-testid="skeleton-line-3" />
        </div>
      </Section>

      <Section id="progress" title="Progress" description="Task/bar progress indicators.">
        <div className="max-w-md space-y-4">
          <div data-testid="progress-33">
            <Progress value={33} aria-label="Loading 33%" />
          </div>
          <div data-testid="progress-75">
            <Progress value={75} aria-label="Loading 75%" />
          </div>
        </div>
      </Section>

      <Section id="avatar" title="Avatar" description="User images with text fallbacks.">
        <Row>
          <Avatar data-testid="avatar-image">
            <AvatarImage src="/logo.svg" alt="VeXeVN" />
            <AvatarFallback>VX</AvatarFallback>
          </Avatar>
          <Avatar data-testid="avatar-fallback">
            <AvatarFallback className="bg-primary text-primary-foreground">
              NA
            </AvatarFallback>
          </Avatar>
          <Avatar data-testid="avatar-large" className="size-12">
            <AvatarFallback>LG</AvatarFallback>
          </Avatar>
        </Row>
      </Section>

      <Section id="separator" title="Separator" description="Visual dividers.">
        <div className="space-y-4">
          <div>
            <p className="text-sm">Above the separator</p>
            <Separator className="my-2" data-testid="separator-h" />
            <p className="text-sm">Below the separator</p>
          </div>
          <div className="flex h-8 items-center gap-2">
            <span className="text-sm">Left</span>
            <Separator orientation="vertical" data-testid="separator-v" />
            <span className="text-sm">Right</span>
          </div>
        </div>
      </Section>

      <Section id="table" title="Table" description="Data tables for admin views.">
        <div className="rounded-md border" data-testid="table-demo">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Route</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Departure</TableHead>
                <TableHead className="text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Hà Nội → Huế</TableCell>
                <TableCell>Thanh Bình</TableCell>
                <TableCell>06:00</TableCell>
                <TableCell className="text-right">350,000₫</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Sài Gòn → Đà Lạt</TableCell>
                <TableCell>Phương Trang</TableCell>
                <TableCell>08:30</TableCell>
                <TableCell className="text-right">380,000₫</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Đà Nẵng → Hà Nội</TableCell>
                <TableCell>Hoàng Long</TableCell>
                <TableCell>21:00</TableCell>
                <TableCell className="text-right">420,000₫</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section id="breadcrumb" title="Breadcrumb" description="Hierarchical navigation trail.">
        <Breadcrumb data-testid="breadcrumb-demo">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#sec-breadcrumb">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#sec-breadcrumb">Search</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Hà Nội → Huế</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Section>

      <Section id="aspect-ratio" title="AspectRatio" description="Fixed-ratio media containers.">
        <AspectRatio
          ratio={16 / 9}
          className="bg-muted flex items-center justify-center rounded-md border"
          data-testid="aspect-ratio-el"
        >
          <span className="text-muted-foreground text-sm">16:9 box</span>
        </AspectRatio>
      </Section>

      <Section id="pagination" title="Pagination" description="Page navigation.">
        <Pagination data-testid="pagination-demo">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#sec-pagination" />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#sec-pagination">1</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#sec-pagination" isActive>
                2
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#sec-pagination">3</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="#sec-pagination" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </Section>
    </>
  )
}
