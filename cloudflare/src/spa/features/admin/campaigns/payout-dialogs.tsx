/** The settle and reject confirmations of the payouts panel. */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  adminCouponsRejectMutation,
  adminCouponsSettleMutation,
  type AdminCouponOut,
} from "@spa/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@spa/components/ui/alert-dialog";
import { Input } from "@spa/components/ui/input";
import { Textarea } from "@spa/components/ui/textarea";
import { getErrorMessage } from "@spa/lib/error-message";
import { useMoney } from "@spa/lib/format";
import { useT } from "@spa/lib/i18n";

export function SettleDialog({
  open,
  ids,
  amount,
  onClose,
}: {
  open: boolean;
  ids: string[];
  amount: number;
  onClose: (done: boolean) => void;
}) {
  const t = useT();
  const money = useMoney();
  const [note, setNote] = useState("");
  const settle = useMutation(adminCouponsSettleMutation());
  const confirm = () =>
    settle.mutate(
      { body: { couponIds: ids, note: note.trim() || null } },
      {
        onSuccess: (r) => {
          toast.success(t("adminCampaigns.settled", { count: r.settled }));
          setNote("");
          onClose(true);
        },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !settle.isPending && onClose(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("adminCampaigns.settleTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("adminCampaigns.settleDesc", { count: ids.length, amount: money(amount) })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("adminCampaigns.settleNote")}
          aria-label={t("adminCampaigns.settleNote")}
          maxLength={500}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={settle.isPending}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={settle.isPending}
            onClick={(e) => {
              e.preventDefault();
              confirm();
            }}
          >
            {settle.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              t("adminCampaigns.settleConfirm")
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function RejectDialog({
  coupon,
  onClose,
}: {
  coupon: AdminCouponOut | null;
  onClose: (done: boolean) => void;
}) {
  const t = useT();
  const money = useMoney();
  const [reason, setReason] = useState("");
  const reject = useMutation(adminCouponsRejectMutation());
  const confirm = () => {
    if (!coupon) return;
    reject.mutate(
      { path: { id: coupon.id }, body: { reason: reason.trim() } },
      {
        onSuccess: () => {
          toast.success(t("adminCampaigns.rejected"));
          setReason("");
          onClose(true);
        },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };
  return (
    <AlertDialog open={!!coupon} onOpenChange={(o) => !o && !reject.isPending && onClose(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("adminCampaigns.rejectTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {coupon && `${coupon.code} · ${money(coupon.amount)}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("adminCampaigns.rejectReason")}
          aria-label={t("adminCampaigns.rejectReason")}
          rows={3}
          maxLength={500}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={reject.isPending}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={reject.isPending || reason.trim().length < 3}
            className="bg-rose-600 hover:bg-rose-700"
            onClick={(e) => {
              e.preventDefault();
              confirm();
            }}
          >
            {reject.isPending ? <Loader2 className="animate-spin" /> : t("adminCampaigns.reject")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
