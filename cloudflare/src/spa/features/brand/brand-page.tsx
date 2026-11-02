/**
 * Brand page — `/brands/$slug`
 *
 * A page of its own for each operator, built around booking them: a
 * route-and-date box at the top that opens the search filtered to this
 * brand, jump links to each section, then their routes with fares and
 * departure times, the trips about to leave (by day, by route), their
 * locations and what passengers say. One request (`useBrandProfile`, answered from the edge
 * cache) feeds everything above the reviews; the reviews are fetched only
 * when the visitor scrolls to them.
 */
import { useNavigate, useParams } from "@tanstack/react-router";
import { useInView } from "@spa/hooks/use-in-view";
import { ErrorState } from "@spa/components/error-state";
import { Skeleton } from "@spa/components/ui/skeleton";
import { HomeSection } from "@spa/features/home/section";
import { ReviewsList } from "@spa/features/reviews/reviews-list";
import { useT } from "@spa/lib/i18n";
import { buildSearchInput, vnDate } from "@spa/lib/search-params";
import { useSearchForm } from "@spa/stores/search-form";
import { useBrandProfile, type ProfileRoute } from "./api";
import { SECTION_IDS, SECTION_SCROLL_MARGIN } from "./brand-format";
import { BrandHero } from "./brand-hero";
import { BrandLocationsSection } from "./brand-locations-section";
import { BrandRoutesSection } from "./brand-routes-section";
import { BrandSectionNav } from "./brand-section-nav";
import { BrandTripsSection } from "./brand-trips-section";

/** Mounts its children once it nears the viewport, so their requests wait for a reader. */
function WhenVisible({ children, minHeight }: { children: React.ReactNode; minHeight: number }) {
  const [ref, seen] = useInView();
  return (
    <div ref={ref} style={seen ? undefined : { minHeight }}>
      {seen ? children : null}
    </div>
  );
}

function BrandPageSkeleton() {
  return (
    <div className="page-x space-y-4 py-8" aria-hidden>
      <Skeleton className="h-20 w-2/3 rounded-2xl" />
      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  );
}

export function BrandPage() {
  const { slug } = useParams({ from: "/brands/$slug" });
  const navigate = useNavigate();
  const t = useT();
  const setSearchParams = useSearchForm((s) => s.setSearchParams);
  const { data: profile, isLoading, isError, refetch } = useBrandProfile(slug);

  // Search a route of this brand, already filtered to it.
  const searchRoute = (route: ProfileRoute, date = vnDate(1)) => {
    const { name: from } = route.from;
    const { name: to } = route.to;
    setSearchParams({ from, to, date });
    navigate({ to: "/search", search: buildSearchInput({ from, to, date, brands: slug }) });
  };

  if (isLoading) return <BrandPageSkeleton />;
  if (isError || !profile) {
    return (
      <div className="page-x py-16">
        <ErrorState description={t("brandDetail.loadError")} onRetry={() => refetch()} />
      </div>
    );
  }

  const { brand } = profile;
  return (
    <div className="pb-8">
      <BrandHero profile={profile} onSearch={searchRoute} />
      <BrandSectionNav
        routes={profile.routes.length}
        trips={profile.trips.length}
        locations={profile.locations.length}
        reviews={brand.reviewCount}
      />
      <BrandRoutesSection routes={profile.routes} onSearch={(r) => searchRoute(r)} />
      <BrandTripsSection trips={profile.trips} routes={profile.routes} />
      <BrandLocationsSection brandName={brand.name} locations={profile.locations} />
      <HomeSection
        id={SECTION_IDS.reviews}
        className={SECTION_SCROLL_MARGIN}
        title={t("brandPage.reviewsTitle")}
      >
        <WhenVisible minHeight={240}>
          <ReviewsList brandId={brand.id} brandName={brand.name} />
        </WhenVisible>
      </HomeSection>
    </div>
  );
}
