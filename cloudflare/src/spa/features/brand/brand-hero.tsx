import { Link } from "@tanstack/react-router";
import { Mail, Phone } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@spa/components/ui/breadcrumb";
import { buttonVariants } from "@spa/components/ui/button";
import { Stars } from "@spa/features/reviews/review-summary";
import { useT } from "@spa/lib/i18n";
import type { BrandProfile, ProfileRoute } from "./api";
import { BrandQuickBook } from "./brand-quick-book";
import { SECTION_IDS } from "./brand-format";

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
};

/** Who the brand is, how good, how to reach them, and the box to book them. */
export function BrandHero({
  profile,
  onSearch,
}: {
  profile: BrandProfile;
  onSearch: (route: ProfileRoute, date: string) => void;
}) {
  const t = useT();
  const { brand, routes } = profile;
  const departures = routes.reduce((sum, r) => sum + r.schedules.length, 0);
  const contact = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <header className="border-b bg-white">
      <div className="page-x space-y-5 py-5 md:py-8">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/">{t("brandPage.backHome")}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{brand.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex items-start gap-4">
          <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-primary text-xl font-bold text-primary-foreground md:size-20">
            {brand.logoUrl ? (
              <img
                src={brand.logoUrl}
                alt=""
                className="size-full bg-white object-contain p-1.5"
                decoding="async"
              />
            ) : (
              initials(brand.name)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-balance text-slate-900 md:text-3xl">
              {brand.name}
            </h1>
            <div className="mt-1.5 text-sm">
              {brand.rating != null ? (
                <a
                  href={`#${SECTION_IDS.reviews}`}
                  className="inline-flex items-center gap-1.5 hover:underline"
                >
                  <Stars rating={brand.rating} />
                  <span className="font-semibold text-amber-600">{brand.rating.toFixed(1)}</span>
                  {brand.reviewCount > 0 && (
                    <span className="text-xs text-slate-500">
                      ({t("reviews.countLabel", { count: brand.reviewCount })})
                    </span>
                  )}
                </a>
              ) : (
                <span className="text-slate-500">{t("brandDetail.noReviewsYet")}</span>
              )}
            </div>
            {routes.length > 0 && (
              <p className="mt-0.5 text-sm text-slate-500">
                {t("brands.routesCount", { count: routes.length })}
                {" · "}
                {t("brandDetail.tripsPerDayCount", { count: departures })}
              </p>
            )}
          </div>
        </div>

        {brand.description && (
          <p className="max-w-3xl text-[15px] leading-relaxed text-slate-600">
            {brand.description}
          </p>
        )}

        {(brand.contactPhone || brand.contactEmail) && (
          <div className="flex flex-wrap gap-2">
            {brand.contactPhone && (
              <a href={`tel:${brand.contactPhone.replace(/\s+/g, "")}`} className={contact}>
                <Phone />
                {brand.contactPhone}
              </a>
            )}
            {brand.contactEmail && (
              <a href={`mailto:${brand.contactEmail}`} className={contact}>
                <Mail />
                {brand.contactEmail}
              </a>
            )}
          </div>
        )}

        <BrandQuickBook brandName={brand.name} routes={routes} onSearch={onSearch} />
      </div>
    </header>
  );
}
