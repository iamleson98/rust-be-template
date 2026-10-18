import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { currentUserFromCookies } from "@/lib/auth/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "DatXE Vui — Đặt vé xe khách toàn quốc",
    template: "%s | DatXE Vui",
  },
  description:
    "Đặt vé xe khách limousine, giường nối các tuyến toàn Việt Nam. Thanh toán linh hoạt, hỗ trợ 24/7.",
  keywords: ["đặt vé xe", "xe khách", "limousine", "giường nằm", "DatXE Vui"],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Header auth state — resolved per-request on the server.
  const user = await currentUserFromCookies();
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className={`${geistSans.variable} font-sans antialiased bg-background text-foreground`}>
        <div className="flex min-h-screen flex-col">
          <SiteHeader user={user} />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
        <Toaster />
      </body>
    </html>
  );
}
