"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmtVnd } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, Play, RefreshCw } from "lucide-react";

interface Stats {
  bookings: Record<string, number>;
  bookingsToday: number;
  revenueTotal: number;
  tripsToday: number;
  chat: Record<string, number>;
}

interface Brand {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  contactPhone: string | null;
  logoUrl: string | null;
  status: string;
  rating: number | null;
  childMaxAge: number | null;
  childDiscountAmount: number | null;
}

interface JobRun {
  job_type: string;
  status: string;
  detail: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export default function AdminPage() {
  const { toast } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [jobs, setJobs] = useState<{ jobType: string; enabled: boolean; nextRunAt: string | null }[]>([]);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [newBrand, setNewBrand] = useState({ name: "", slug: "", phone: "", description: "" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Brand | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [s, b, j] = await Promise.all([
        api.get<Stats>("/api/admin/stats"),
        api.get<{ items: Brand[] }>("/api/admin/brands"),
        api.get<{ items: { jobType: string; enabled: boolean; nextRunAt: string | null }[]; recentRuns: JobRun[] }>(
          "/api/admin/cron-jobs",
        ),
      ]);
      setStats(s);
      setBrands(b.items);
      setJobs(j.items);
      setRuns(j.recentRuns);
    } catch (e) {
      if ((e as { status?: number }).status === 401 || (e as { status?: number }).status === 403) {
        setUnauthorized(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function createBrand() {
    try {
      await api.post("/api/admin/brands", {
        name: newBrand.name,
        slug: newBrand.slug || undefined,
        contactPhone: newBrand.phone || undefined,
        description: newBrand.description || undefined,
      });
      toast({ title: "Đã tạo nhà xe" });
      setNewBrand({ name: "", slug: "", phone: "", description: "" });
      loadAll();
    } catch (e) {
      toast({ title: "Lỗi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }

  async function saveBrand() {
    if (!editing) return;
    try {
      await api.put(`/api/admin/brands/${editing.id}`, {
        name: editing.name,
        description: editing.description ?? undefined,
        contactPhone: editing.contactPhone ?? undefined,
        logoUrl: editing.logoUrl ?? undefined,
        status: editing.status,
      });
      toast({ title: "Đã lưu" });
      setDialogOpen(false);
      loadAll();
    } catch (e) {
      toast({ title: "Lỗi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }

  async function uploadLogo(brand: Brand, file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.upload<{ url: string }>("/api/uploads/brand-logo", form);
      await api.put(`/api/admin/brands/${brand.id}`, { logoUrl: res.url });
      toast({ title: "Đã tải logo lên R2" });
      loadAll();
    } catch (e) {
      toast({ title: "Tải lên thất bại", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function triggerJob(jobType: string) {
    try {
      const r = await api.post<{ status: string }>(`/api/admin/cron-jobs/${jobType}/trigger`);
      toast({ title: `Đã chạy ${jobType}`, description: `Trạng thái: ${r.status}` });
      loadAll();
    } catch (e) {
      toast({ title: "Lỗi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-6xl px-4 py-6"><Skeleton className="h-96 w-full" /></div>;
  }

  if (unauthorized) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 text-center">
        <p className="text-muted-foreground">Bạn không có quyền truy cập trang quản trị.</p>
        <a href="/" className="mt-4 inline-block"><Button variant="outline">Về trang chủ</Button></a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-xl font-bold">Quản trị</h1>
        <Button variant="ghost" size="icon" onClick={loadAll} aria-label="Làm mới">
          <RefreshCw className="size-4" />
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Tổng quan</TabsTrigger>
          <TabsTrigger value="brands">Nhà xe</TabsTrigger>
          <TabsTrigger value="jobs">Cron jobs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Đơn hôm nay" value={String(stats?.bookingsToday ?? 0)} />
            <Stat label="Đang chờ" value={String(stats?.bookings.pending ?? 0)} />
            <Stat label="Đã xác nhận" value={String(stats?.bookings.confirmed ?? 0)} />
            <Stat label="Doanh thu" value={fmtVnd(stats?.revenueTotal ?? 0)} />
          </div>
          <Card className="border">
            <CardContent className="p-4 text-sm">
              <p className="font-medium">Chat hỗ trợ</p>
              <p className="mt-1 text-muted-foreground">
                Đang mở: {stats?.chat.open ?? 0} · Đã nhận: {stats?.chat.assigned ?? 0} · Đã đóng:{" "}
                {stats?.chat.closed ?? 0} — nhân viên vào <b>/support</b> để trả lời khách.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="brands" className="space-y-3">
          <Card className="border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Thêm nhà xe</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              <div className="space-y-1 sm:col-span-1">
                <Label htmlFor="b-name">Tên</Label>
                <Input id="b-name" value={newBrand.name} onChange={(e) => setNewBrand({ ...newBrand, name: e.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-1">
                <Label htmlFor="b-slug">Slug</Label>
                <Input id="b-slug" value={newBrand.slug} onChange={(e) => setNewBrand({ ...newBrand, slug: e.target.value })} placeholder="tự động" />
              </div>
              <div className="space-y-1 sm:col-span-1">
                <Label htmlFor="b-phone">Hotline</Label>
                <Input id="b-phone" value={newBrand.phone} onChange={(e) => setNewBrand({ ...newBrand, phone: e.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-1">
                <Label htmlFor="b-desc">Mô tả</Label>
                <Input id="b-desc" value={newBrand.description} onChange={(e) => setNewBrand({ ...newBrand, description: e.target.value })} />
              </div>
              <div className="flex items-end sm:col-span-1">
                <Button className="w-full" onClick={createBrand} disabled={!newBrand.name.trim()}>Thêm</Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {brands.map((b) => (
              <Card key={b.id} className="border">
                <CardContent className="flex flex-wrap items-center gap-3 p-3">
                  <div className="flex size-10 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {b.logoUrl ? (
                          <img src={b.logoUrl} alt={b.name} className="size-full object-cover" />
                    ) : (
                      <span className="text-xs font-bold">{b.name.slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {b.name} <Badge variant={b.status === "active" ? "default" : "secondary"}>{b.status}</Badge>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      /{b.slug} · {b.contactPhone ?? "—"}
                    </p>
                  </div>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && uploadLogo(b, e.target.files[0])}
                    />
                    <Button variant="outline" size="sm" asChild disabled={uploading}>
                      <span>
                        <Upload className="mr-1 size-4" aria-hidden /> Logo → R2
                      </span>
                    </Button>
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(b);
                      setDialogOpen(true);
                    }}
                  >
                    Sửa
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="jobs" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Cron chạy trong Cloudflare Container (node-cron tick mỗi phút → <code>POST /api/jobs/tick</code>).
          </p>
          <div className="space-y-2">
            {jobs.map((j) => (
              <Card key={j.jobType} className="border">
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="flex-1">
                    <p className="font-mono text-sm font-medium">{j.jobType}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.enabled ? "Đang bật" : "Đang tắt"}
                      {j.nextRunAt ? ` · lần chạy sau ${new Date(j.nextRunAt).toLocaleString("vi-VN")}` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => triggerJob(j.jobType)}>
                    <Play className="mr-1 size-4" aria-hidden /> Chạy ngay
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="border">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Lịch sử chạy gần đây</CardTitle>
            </CardHeader>
            <CardContent className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2">Job</th>
                    <th className="pb-2">Trạng thái</th>
                    <th className="pb-2">Chi tiết</th>
                    <th className="pb-2">Thời điểm</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1.5 font-mono text-xs">{r.job_type}</td>
                      <td className="py-1.5">
                        <Badge variant={r.status === "succeeded" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="max-w-48 truncate py-1.5 text-xs text-muted-foreground">
                        {r.error ?? r.detail ?? "—"}
                      </td>
                      <td className="py-1.5 text-xs text-muted-foreground">
                        {r.finished_at ? new Date(r.finished_at).toLocaleString("vi-VN") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sửa nhà xe</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-name">Tên</Label>
                <Input id="e-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-phone">Hotline</Label>
                <Input id="e-phone" value={editing.contactPhone ?? ""} onChange={(e) => setEditing({ ...editing, contactPhone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-desc">Mô tả</Label>
                <Input id="e-desc" value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-status">Trạng thái</Label>
                <select
                  id="e-status"
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={editing.status}
                  onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Hủy</Button>
            <Button onClick={saveBrand}>Lưu</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border">
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
