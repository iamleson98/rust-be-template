/**
 * A path no page has: a real 404 for crawlers, while the SPA still renders
 * its own "page not found" screen with the site's navigation.
 */
import type { Metadata } from "next";
import { vi } from "@spa/lib/i18n/vi";
import { SpaEntry } from "./spa-entry";

export const metadata: Metadata = {
  title: vi["seo.notFound.title"],
  description: null,
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return <SpaEntry />;
}
