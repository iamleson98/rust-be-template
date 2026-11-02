import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleCheck, Wallet, X } from "lucide-react";
import { adminCouponsListOptions, adminCouponsPayoutsOptions, type AdminCouponOut } from "@spa/api";
import { EmptyState, Panel } from "@spa/components/console/panel";
import { Segmented } from "@spa/components/console/segmented";
import { StatGrid, StatTile } from "@spa/components/console/stat-tile";
import { Button } from "@spa/components/ui/button";
import { Skeleton } from "@spa/components/ui/skeleton";
import { formatNum, useMoney } from "@spa/lib/format";
import { useT } from "@spa/lib/i18n";
import { cn } from "@spa/lib/utils";
import { CouponRow, Tick } from "./coupon-row";
import { RejectDialog, SettleDialog } from "./payout-dialogs";

const PAGE = 50;

const STATUSES = ["redeemed", "reserved", "held", "settled", "rejected"] as const;

type Status = (typeof STATUSES)[number];

/**
 * Paying operators for coupons used on trips that were made: what is owed per
 * operator, then the coupons themselves with the signs of abuse to check
 * before paying (one phone or network behind many coupons, a brand-new
 * account). Paid and refused coupons are final.
 */
export function PayoutsPanel() {
  const t = useT();
  const money = useMoney();
  const [status, setStatus] = useState<Status>("redeemed");
  const [brand, setBrand] = useState<{ id: string; name: string } | null>(null);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [settling, setSettling] = useState(false);
  const [rejecting, setRejecting] = useState<AdminCouponOut | null>(null);

  const payouts = useQuery(adminCouponsPayoutsOptions());
  const coupons = useQuery({
    ...adminCouponsListOptions({
      query: { status, brandId: brand?.id, limit: PAGE, offset: page * PAGE },
    }),
    placeholderData: keepPreviousData,
  });
  const items = coupons.data?.items ?? [];
  const total = coupons.data?.total ?? 0;
  const payable = status === "redeemed";
  const pickedItems = items.filter((c) => picked.includes(c.id));
  const pickedAmount = pickedItems.reduce((sum, c) => sum + c.amount, 0);

  const filter = (next: { status?: Status; brand?: typeof brand }) => {
    if (next.status) setStatus(next.status);
    if (next.brand !== undefined) setBrand(next.brand);
    setPage(0);
    setPicked([]);
  };
  const togglePick = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const allPicked = items.length > 0 && items.every((c) => picked.includes(c.id));

  return (
    <div className="space-y-5">
      <StatGrid>
        <StatTile
          label={t("adminCampaigns.owed")}
          value={payouts.data ? money(payouts.data.totalOwed) : "—"}
          icon={<Wallet />}
          tone="amber"
        />
        <StatTile
          label={t("adminCampaigns.paid")}
          value={payouts.data ? money(payouts.data.totalPaid) : "—"}
          icon={<CircleCheck />}
          tone="green"
        />
      </StatGrid>

      <Panel title={t("adminCampaigns.payoutsTitle")} icon={<Wallet />}>
        {payouts.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !payouts.data?.items.length ? (
          <EmptyState icon={<Wallet />} text={t("adminCampaigns.payoutsEmpty")} />
        ) : (
          <ul className="divide-y divide-border/60">
            {payouts.data.items.map((p) => {
              const name = p.brand?.name ?? t("adminCampaigns.unknownOperator");
              const active = !!p.brand && brand?.id === p.brand.id;
              return (
                <li key={p.brand?.id ?? "none"}>
                  <button
                    type="button"
                    disabled={!p.brand}
                    onClick={() =>
                      p.brand &&
                      filter({
                        status: "redeemed",
                        brand: active ? null : { id: p.brand.id, name },
                      })
                    }
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:hover:bg-transparent",
                      active && "bg-primary/5",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                    <span className="shrink-0 text-right text-xs tabular-nums">
                      <span
                        className={cn(
                          "block font-semibold",
                          p.owedAmount > 0
                            ? "text-amber-700 dark:text-amber-300"
                            : "text-muted-foreground",
                        )}
                      >
                        {p.owedCount > 0
                          ? t("adminCampaigns.totalOwed", {
                              amount: money(p.owedAmount),
                              count: formatNum(p.owedCount),
                            })
                          : t("adminCampaigns.nothingOwed")}
                      </span>
                      <span className="block text-muted-foreground">
                        {t("adminCampaigns.totalPaid", { amount: money(p.paidAmount) })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title={t("adminCampaigns.reviewTitle")} icon={<AlertTriangle />}>
        <p className="mb-3 text-xs text-muted-foreground">{t("adminCampaigns.reviewHint")}</p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="-m-1 max-w-full overflow-x-auto p-1 scrollbar-none">
            <Segmented
              label={t("common.status")}
              value={status}
              onChange={(s) => filter({ status: s })}
              options={STATUSES.map((s) => ({ value: s, label: t(`adminCampaigns.status.${s}`) }))}
            />
          </div>
          {brand && (
            <button
              type="button"
              onClick={() => filter({ brand: null })}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
            >
              {brand.name}
              <X className="size-3.5" aria-label={t("adminCampaigns.clearOperator")} />
            </button>
          )}
        </div>

        {coupons.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<CircleCheck />} text={t("adminCampaigns.reviewEmpty")} />
        ) : (
          <>
            {payable && (
              <button
                type="button"
                role="checkbox"
                aria-checked={allPicked}
                onClick={() => setPicked(allPicked ? [] : items.map((c) => c.id))}
                className="mb-1 flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground"
              >
                <Tick on={allPicked} />
                {t("adminCampaigns.pickAll")}
              </button>
            )}
            <ul className="divide-y divide-border/60">
              {items.map((c) => (
                <CouponRow
                  key={c.id}
                  coupon={c}
                  payable={payable}
                  picked={picked.includes(c.id)}
                  onPick={() => togglePick(c.id)}
                  onReject={() => setRejecting(c)}
                />
              ))}
            </ul>
            {payable && picked.length > 0 && (
              // Sticks above the floating call and support buttons, so a long list never hides it.
              <div className="sticky bottom-24 z-10 mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-2.5 text-white shadow-lg dark:bg-slate-800">
                <span className="text-sm font-medium tabular-nums">
                  {t("adminCampaigns.pickedSummary", {
                    count: formatNum(picked.length),
                    amount: money(pickedAmount),
                  })}
                </span>
                <Button size="sm" variant="secondary" onClick={() => setSettling(true)}>
                  <Check />
                  {t("adminCampaigns.settleConfirm")}
                </Button>
              </div>
            )}
            {total > PAGE && (
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {formatNum(page * PAGE + 1)}–{formatNum(Math.min(total, (page + 1) * PAGE))} /{" "}
                  {formatNum(total)}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    {t("common.prevPage")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(page + 1) * PAGE >= total}
                    onClick={() => setPage(page + 1)}
                  >
                    {t("common.nextPage")}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      <SettleDialog
        open={settling}
        ids={picked}
        amount={pickedAmount}
        onClose={(done) => {
          setSettling(false);
          if (done) setPicked([]);
        }}
      />
      <RejectDialog
        coupon={rejecting}
        onClose={(done) => {
          if (done && rejecting) setPicked((p) => p.filter((x) => x !== rejecting.id));
          setRejecting(null);
        }}
      />
    </div>
  );
}
