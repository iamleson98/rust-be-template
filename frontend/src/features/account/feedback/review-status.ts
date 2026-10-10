/** Moderation state of a submitted review → label key and badge colours. */
export const REVIEW_STATUS: Record<string, { labelKey: string; cls: string }> = {
  pending: {
    labelKey: 'accountPage.feedback.statusPending',
    cls: 'bg-amber-500/10 text-amber-600 ring-amber-500/20',
  },
  approved: {
    labelKey: 'accountPage.feedback.statusApproved',
    cls: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20',
  },
  rejected: {
    labelKey: 'accountPage.feedback.statusRejected',
    cls: 'bg-rose-500/10 text-rose-600 ring-rose-500/20',
  },
  hidden: {
    labelKey: 'accountPage.feedback.statusHidden',
    cls: 'bg-slate-500/10 text-slate-600 ring-slate-500/20',
  },
}
