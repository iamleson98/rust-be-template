import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-muted/40">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-foreground">DatXE Vui</p>
          <p>Đặt vé xe khách toàn quốc — chạy trên Cloudflare Workers.</p>
        </div>
        <nav className="flex flex-wrap gap-4" aria-label="Liên kết chân trang">
          <Link href="/" className="hover:text-foreground">Đặt vé</Link>
          <Link href="/support" className="hover:text-foreground">Hỗ trợ</Link>
          <Link href="/login" className="hover:text-foreground">Đăng nhập</Link>
        </nav>
      </div>
    </footer>
  );
}
