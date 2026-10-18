import { Suspense, useEffect } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { IslandFallback } from "@spa/components/island-fallback";
import { useAuthMe } from "@spa/features/auth/api";
import { cn } from "@spa/lib/utils";
import { useBookingFlow } from "@spa/stores/booking-flow";
import { useSession } from "@spa/stores/session";
import { Header } from "./layout/header";
import { Deferred, Footer, MobileNav, Overlays, SupportFab } from "./overlays";
import { RouteMeta } from "./route-meta";

/** Back to the top on navigation — but not when only the search params change. */
function ScrollToTop() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Keeps the cached session in step with the server and locks scroll behind the booking flow. */
function SessionSync() {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const bookingOpen = useBookingFlow((s) => s.step !== "idle");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { data, isLoading, isError } = useAuthMe();

  useEffect(() => {
    if (isLoading) return;
    if (isError || !data) {
      if (user) setUser(null);
    } else {
      setUser(data.user);
    }
  }, [data, isLoading, isError]); // eslint-disable-line react-hooks/exhaustive-deps

  // A session that died SERVER-side (expired refresh cookie, sign-out in
  // another tab) would otherwise leave a zombie console behind: the route
  // guards only re-run on navigation, so the open tab keeps rendering
  // /admin or /account with every widget 401-ing. When the verified
  // session is gone while a private area is on screen, go to the login
  // page with a way back. The SPA's own logout never lands here — it
  // clears the query cache first, so `data` goes back to loading and the
  // redirect below does not race its navigate-home.
  useEffect(() => {
    if (user) return;
    const inPrivateArea = pathname.startsWith("/admin") || pathname.startsWith("/account");
    if (!inPrivateArea) return;
    navigate({ to: "/login", search: { redirect: pathname }, replace: true });
  }, [user, pathname, navigate]);

  useEffect(() => {
    document.body.style.overflow = bookingOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [bookingOpen]);

  return null;
}

/** Customer chrome (header, footer, mobile nav, overlays) around every page; the admin console brings its own shell. */
export function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The admin console brings its own frame; the account area lives in the site chrome.
  const ownShell = pathname.startsWith("/admin");

  return (
    // Every page sits on the soft canvas; white cards lift off it.
    <div className="flex min-h-screen flex-col bg-canvas">
      <RouteMeta />
      <ScrollToTop />
      <SessionSync />
      {!ownShell && <Header />}

      <main
        id="main-content"
        tabIndex={-1}
        // Clears the customer MobileNav bar (4rem) and the iOS home indicator.
        className={cn(
          "flex-1 outline-none",
          !ownShell && "pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0",
        )}
      >
        <Suspense fallback={<IslandFallback minHeight={500} />}>
          <Outlet />
        </Suspense>
      </main>

      {!ownShell && pathname !== "/login" && !pathname.startsWith("/account") && (
        <Deferred>
          <Footer />
        </Deferred>
      )}
      <Overlays />
      {!ownShell && (
        <>
          <Deferred>
            <MobileNav />
          </Deferred>
          <Deferred>
            <SupportFab />
          </Deferred>
        </>
      )}
    </div>
  );
}
