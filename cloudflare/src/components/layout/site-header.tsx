"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api, type SessionUser } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Bus, LogIn, LogOut, Menu, Ticket, MessageCircle, LayoutDashboard, User } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const NAV = [
  { href: "/", label: "Đặt vé", icon: Bus },
  { href: "/bookings", label: "Vé của tôi", icon: Ticket },
  { href: "/support", label: "Hỗ trợ", icon: MessageCircle },
];

export function SiteHeader({ user }: { user: SessionUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await api.post("/api/auth/logout", {});
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const isStaff = user?.role === "admin" || user?.role === "employee";

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-primary">
          <Bus className="size-6" aria-hidden />
          <span className="text-lg">DatXE Vui</span>
        </Link>

        <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Điều hướng chính">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground ${
                pathname === n.href ? "bg-accent text-accent-foreground" : "text-muted-foreground"
              }`}
            >
              {n.label}
            </Link>
          ))}
          {isStaff && (
            <Link
              href="/admin"
              className={`flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground ${
                pathname.startsWith("/admin") ? "bg-accent text-accent-foreground" : "text-muted-foreground"
              }`}
            >
              <LayoutDashboard className="size-4" aria-hidden /> Quản trị
            </Link>
          )}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          {user ? (
            <>
              <Link href="/account" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent">
                <User className="size-4" aria-hidden /> {user.fullName.split(" ").slice(-1)[0]}
              </Link>
              <Button variant="ghost" size="sm" onClick={logout} disabled={busy} aria-label="Đăng xuất">
                <LogOut className="size-4" aria-hidden />
              </Button>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  <LogIn className="mr-1 size-4" aria-hidden /> Đăng nhập
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm">Đăng ký</Button>
              </Link>
            </>
          )}
        </div>

        {/* Mobile nav */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="ml-auto md:hidden" aria-label="Mở menu">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>DatXE Vui</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 px-4" aria-label="Điều hướng di động">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium hover:bg-accent"
                >
                  <n.icon className="size-4" aria-hidden /> {n.label}
                </Link>
              ))}
              {isStaff && (
                <Link href="/admin" className="flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium hover:bg-accent">
                  <LayoutDashboard className="size-4" aria-hidden /> Quản trị
                </Link>
              )}
              {user ? (
                <button
                  onClick={logout}
                  className="flex items-center gap-3 rounded-md px-3 py-3 text-left text-sm font-medium text-destructive hover:bg-accent"
                >
                  <LogOut className="size-4" aria-hidden /> Đăng xuất ({user.fullName})
                </button>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  <Link href="/login">
                    <Button variant="outline" className="w-full">Đăng nhập</Button>
                  </Link>
                  <Link href="/register">
                    <Button className="w-full">Đăng ký</Button>
                  </Link>
                </div>
              )}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
