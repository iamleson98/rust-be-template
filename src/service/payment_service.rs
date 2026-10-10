//! Payment service — business logic for the payment flow.
//!
//! Sits between the route layer (`/api/payments/*`,
//! `/api/admin/payments/*`, `/api/payments/ipn/{provider}`) and the
//! store + provider layers. Responsibilities:
//!
//! - Create a `payment` row + dispatch to the correct `Provider` impl.
//! - Verify provider signatures on IPN callbacks (delegated to the
//!   provider impl) + transition the payment state machine.
//! - On payment completion, call `BookingService::confirm()` to mark
//!   the booking `confirmed` + flip held seats to `booked`.
//! - For COD: handle the manual "cash collected" mark by the driver.
//!
//! ## State machine
//!
//! ```text
//!                  create_payment()
//! pending ──────────────────────────────► [provider gateway]
//!   │                                          │
//!   │  cancel()                                │  IPN webhook
//!   ▼                                          ▼
//! cancelled ◄──────────────────────────── completed
//!   │                                          │
//!   │                                          │  admin update_status
//!   │                                          ▼
//!   └──────────────────────────────────► refunded
//! ```
//!
//! A `pending` payment has exactly one path to `completed`: via the
//! provider's IPN callback (for online providers) or via
//! `mark_cod_collected` (for COD). The admin `update_status` route can
//! transition a `completed` payment to `refunded`, or `pending` to
//! `cancelled`/`failed` for manual overrides.

use std::sync::Arc;

use chrono::Utc;
use sea_orm::{Set, TransactionTrait};
use uuid::Uuid;

use crate::config::PaymentConfig;
use crate::dto::payment::{
    AdminPaymentListResponse, AdminPaymentOut, AdminPaymentSummary, BankTransferInstructions,
    CancelPaymentResponse, CreatePaymentReq, CreatePaymentResponse, ListPaymentsResponse,
    MarkCodCollectedResponse, PaymentOut, PaymentProvidersResponse, UpdatePaymentStatusResponse,
};
use crate::entity::payment::{self};
use crate::error::{AppError, AppResult};
use crate::payment::cod::CodProvider;
use crate::payment::momo::{MomoIpnPayload, MomoProvider};
use crate::payment::provider::{CreatePaymentInput, Provider};
use crate::payment::vietqr::VietQrProvider;
use crate::payment::vnpay::VnpayProvider;
use crate::payment::zalopay::{ZalopayCallbackPayload, ZalopayProvider};
use crate::payment::{providers, statuses};
use crate::service::booking_service::hold_expired;
use crate::store::CompositeStore;

use base64::Engine;

/// A booking and its payments belong to the user who made the booking.
/// Only a booking with no owner at all (a legacy guest booking) is open
/// to whoever holds its id. Signed-out callers get 401 on an owned
/// booking so the client can send them to sign in.
fn ensure_owner(owner: Option<Uuid>, caller: Option<&str>) -> AppResult<()> {
    let Some(owner) = owner else { return Ok(()) };
    match caller {
        None => Err(AppError::Unauthorized("sign in to continue".into())),
        Some(c) if Uuid::parse_str(c) == Ok(owner) => Ok(()),
        Some(_) => Err(AppError::Forbidden("not your booking".into())),
    }
}

// ────────────────────────────────────────────────────────────────
//  Service
// ────────────────────────────────────────────────────────────────

pub struct PaymentService {
    store: Arc<CompositeStore>,
    booking: Arc<crate::service::BookingService>,
    cfg: Arc<PaymentConfig>,
    // Provider instances — built once at startup, shared via Arc clones.
    vnpay: Arc<VnpayProvider>,
    momo: Arc<MomoProvider>,
    zalopay: Arc<ZalopayProvider>,
    vietqr: Arc<VietQrProvider>,
    cod: Arc<CodProvider>,
}

impl PaymentService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        store: Arc<CompositeStore>,
        booking: Arc<crate::service::BookingService>,
        cfg: Arc<PaymentConfig>,
        vnpay: Arc<VnpayProvider>,
        momo: Arc<MomoProvider>,
        zalopay: Arc<ZalopayProvider>,
        vietqr: Arc<VietQrProvider>,
        cod: Arc<CodProvider>,
    ) -> Self {
        Self {
            store,
            booking,
            cfg,
            vnpay,
            momo,
            zalopay,
            vietqr,
            cod,
        }
    }

    fn select_provider(&self, name: &str) -> Result<Arc<dyn Provider>, AppError> {
        match name {
            providers::VNPAY if self.cfg.vnpay.is_active() => Ok(self.vnpay.clone()),
            providers::MOMO if self.cfg.momo.is_active() => Ok(self.momo.clone()),
            providers::ZALOPAY if self.cfg.zalopay.is_active() => Ok(self.zalopay.clone()),
            providers::VIETQR if self.cfg.vietqr.is_active() => Ok(self.vietqr.clone()),
            providers::COD if self.cfg.cod_enabled => Ok(self.cod.clone()),
            other => Err(AppError::BadRequest(format!(
                "provider '{other}' is not enabled"
            ))),
        }
    }

    /// The providers checkout can offer: exactly those `select_provider` accepts.
    pub fn enabled_providers(&self) -> PaymentProvidersResponse {
        PaymentProvidersResponse {
            providers: providers::ALL
                .iter()
                .filter(|p| self.select_provider(p).is_ok())
                .map(|p| p.to_string())
                .collect(),
        }
    }

    // ── User-facing ops ──────────────────────────────────────────

    /// Create a payment intent for a booking.
    ///
    /// - Verifies the booking is in `pending` status (not yet confirmed).
    /// - Cancels any prior pending payment for the same booking (one
    ///   active payment per booking at a time).
    /// - Dispatches to the provider's `create_payment` impl.
    /// - Inserts the `payment` row.
    pub async fn create_payment(
        &self,
        req: &CreatePaymentReq,
        user_id: Option<&str>,
    ) -> AppResult<CreatePaymentResponse> {
        req.validate_provider()?;

        // Look up the booking.
        let booking = self
            .store
            .booking_store()
            .find_booking_by_id(req.booking_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        ensure_owner(booking.user_id, user_id)?;
        if booking.status != "pending" {
            return Err(AppError::BadRequest(format!(
                "booking is not in pending status (current: {})",
                booking.status
            )));
        }
        if hold_expired(&booking) {
            return Err(AppError::Gone("booking hold has expired".into()));
        }
        // Paying on board places the booking: its seats wait until departure
        // for the operator's confirmation call. A gateway payment needs longer
        // than the checkout hold; the seats stay put while it runs.
        let held = if req.provider == providers::COD {
            self.booking
                .hold_until_departure(&booking, providers::COD)
                .await?
        } else {
            self.booking
                .hold_for_payment(booking.id, &req.provider)
                .await?
        };
        if !held {
            return Err(AppError::BadRequest(
                "booking is not in pending status".into(),
            ));
        }

        // Cancel any prior pending payment for this booking — one
        // active payment per booking. Atomic conditional UPDATE.
        self.cancel_prior_pending_payments(booking.id).await?;

        // Dispatch to provider.
        let provider = self.select_provider(&req.provider)?;
        let return_url = format!(
            "{}/payments/{}/return",
            self.cfg.public_base_url.trim_end_matches('/'),
            booking.id
        );
        let ipn_url = format!(
            "{}/api/payments/ipn/{}",
            self.cfg.public_base_url.trim_end_matches('/'),
            req.provider
        );
        let memo = format!("VEXEVN-{}", booking.code.to_uppercase());

        let input = CreatePaymentInput {
            payment_id: Uuid::new_v4().to_string(),
            booking_code: booking.code.clone(),
            amount: booking.total,
            currency: booking.currency.clone(),
            return_url,
            ipn_url,
            memo,
        };

        let result = provider.create_payment(&input).await?;

        // Insert the payment row.
        let payment_id = Uuid::new_v4();
        let now = now_iso();
        let active = payment::ActiveModel {
            id: Set(payment_id),
            booking_id: Set(booking.id),
            user_id: Set(booking.user_id),
            provider: Set(req.provider.clone()),
            status: Set(statuses::PENDING.to_string()),
            amount: Set(booking.total),
            currency: Set(booking.currency.clone()),
            created_at: Set(now.clone()),
            updated_at: Set(now),
            provider_txn_ref: Set(result.provider_txn_ref.clone()),
            provider_trans_id: Set(None),
            gateway_url: Set(result.gateway_url.clone()),
            qr_payload: Set(result.qr_payload.clone()),
            memo: Set(Some(input.memo.clone())),
            provider_response: Set(Some(result.provider_response.clone())),
            failure_reason: Set(None),
            created_by: Set(user_id.and_then(|s| Uuid::parse_str(s).ok())),
            collected_at: Set(None),
            collected_by: Set(None),
        };
        self.store
            .payment_store()
            .insert(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Re-fetch to get the row as stored.
        let model = self
            .store
            .payment_store()
            .find_by_id(payment_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::Internal("payment row not found after insert".into()))?;

        let payment_out = self.to_payment_out(&model, &result.qr_image_png);
        Ok(CreatePaymentResponse {
            payment: payment_out,
        })
    }

    /// Fetch a single payment by id. Caller must own the payment's
    /// booking (or be admin — admin path goes through `get_admin`).
    pub async fn get(&self, id: Uuid, user_id: Option<&str>) -> AppResult<PaymentOut> {
        let p = self
            .store
            .payment_store()
            .find_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("payment not found".into()))?;

        self.assert_ownership(&p, user_id).await?;

        Ok(self.to_payment_out(&p, &None))
    }

    /// List payments for a booking. Caller must own the booking.
    pub async fn list_by_booking(
        &self,
        booking_id: Uuid,
        user_id: Option<&str>,
    ) -> AppResult<ListPaymentsResponse> {
        let booking = self
            .store
            .booking_store()
            .find_booking_by_id(booking_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;
        ensure_owner(booking.user_id, user_id)?;

        let payments = self
            .store
            .payment_store()
            .list_by_booking(booking_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let items = payments
            .iter()
            .map(|p| self.to_payment_out(p, &None))
            .collect();
        Ok(ListPaymentsResponse { items, total: None })
    }

    /// Cancel a pending payment (user-initiated). Does NOT cancel the
    /// booking — the user can immediately create a new payment with a
    /// different provider.
    pub async fn cancel(
        &self,
        id: Uuid,
        user_id: Option<&str>,
        reason: Option<&str>,
    ) -> AppResult<CancelPaymentResponse> {
        let p = self
            .store
            .payment_store()
            .find_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("payment not found".into()))?;

        // Ownership check (same logic as `get`).
        self.assert_ownership(&p, user_id).await?;

        if p.status != statuses::PENDING {
            return Err(AppError::BadRequest(format!(
                "payment is not in pending status (current: {})",
                p.status
            )));
        }

        let now = now_iso();
        let mut active: payment::ActiveModel = p.into();
        active.status = Set(statuses::CANCELLED.to_string());
        active.updated_at = Set(now.clone());
        active.failure_reason = Set(reason.map(|s| s.to_string()));
        let updated = self
            .store
            .payment_store()
            .update(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(CancelPaymentResponse {
            payment_id: updated.id,
            status: updated.status,
            cancelled_at: now,
            reason: updated.failure_reason,
        })
    }

    // ── COD: mark collected by driver / admin ────────────────────

    /// Mark a COD payment as collected (cash received by driver).
    /// Transitions payment `pending → completed` and confirms the booking.
    pub async fn mark_cod_collected(
        &self,
        id: Uuid,
        admin_user_id: Uuid,
        amount_collected: Option<i64>,
        _note: Option<String>,
    ) -> AppResult<MarkCodCollectedResponse> {
        let p = self
            .store
            .payment_store()
            .find_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("payment not found".into()))?;

        if p.provider != providers::COD {
            return Err(AppError::BadRequest(
                "mark-cod-collected is only valid for COD payments".into(),
            ));
        }
        if p.status != statuses::PENDING {
            return Err(AppError::BadRequest(format!(
                "payment is not in pending status (current: {})",
                p.status
            )));
        }

        let now = now_iso();
        let amount = amount_collected.unwrap_or(p.amount);

        // Transition payment → completed + record collection info.
        let mut active: payment::ActiveModel = p.into();
        active.status = Set(statuses::COMPLETED.to_string());
        active.updated_at = Set(now.clone());
        active.collected_at = Set(Some(now.clone()));
        active.collected_by = Set(Some(admin_user_id));
        let updated = self
            .store
            .payment_store()
            .update(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Confirm the booking (flips seats from held → booked).
        // `confirm_as_system` because this is a server-side call (no
        // user in context) — payment has been verified, so bypass
        // the per-row ownership check.
        self.confirm_paid_booking(updated.booking_id, updated.id, providers::COD)
            .await?;

        Ok(MarkCodCollectedResponse {
            payment_id: updated.id,
            status: updated.status,
            amount_collected: amount,
            collected_at: now,
        })
    }

    // ── IPN webhook handlers ─────────────────────────────────────

    /// VNPay IPN: GET callback with all params in the query string.
    pub async fn handle_vnpay_ipn(
        &self,
        params: &std::collections::BTreeMap<String, String>,
    ) -> AppResult<()> {
        let (_, txn_ref) = self.vnpay.verify_ipn(params)?;

        // Look up payment by txn_ref.
        let p = self
            .store
            .payment_store()
            .find_by_txn_ref(&txn_ref)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| {
                AppError::NotFound(format!("payment with txn_ref {txn_ref} not found"))
            })?;

        // Idempotency: if already terminal, return Ok without double-confirming.
        if statuses::is_terminal(&p.status) {
            tracing::info!(
                payment_id = %p.id,
                txn_ref = %txn_ref,
                status = %p.status,
                "VNPay IPN received for already-terminal payment — no-op"
            );
            return Ok(());
        }

        // Extract the gateway's response code. `vnp_ResponseCode == "00"`
        // means success; `vnp_TransactionStatus == "00"` confirms the
        // transaction was successful.
        let response_code = params
            .get("vnp_ResponseCode")
            .map(|s| s.as_str())
            .unwrap_or("");
        let txn_status = params
            .get("vnp_TransactionStatus")
            .map(|s| s.as_str())
            .unwrap_or("");
        let provider_trans_id = params.get("vnp_TransactionNo").cloned();
        let amount_param = params.get("vnp_Amount").and_then(|s| s.parse::<i64>().ok());

        if response_code == "00" && txn_status == "00" {
            // Success. Verify amount matches.
            let expected = p.amount * 100; // VNPay uses cents (VND × 100)
            if let Some(actual) = amount_param {
                if actual != expected {
                    tracing::error!(
                        payment_id = %p.id,
                        txn_ref = %txn_ref,
                        expected_amount_cents = expected,
                        actual_amount_cents = actual,
                        "VNPay IPN amount mismatch — marking payment failed"
                    );
                    self.mark_failed(
                        &p,
                        format!("amount mismatch: expected {expected}, got {actual}"),
                        serde_json::to_string(params).unwrap_or_default(),
                    )
                    .await?;
                    return Ok(());
                }
            }

            self.mark_completed(
                p,
                provider_trans_id,
                serde_json::to_string(params).unwrap_or_default(),
            )
            .await?;
        } else {
            // Failure — mark payment failed (booking stays pending so the
            // user can retry with a different provider).
            self.mark_failed(
                &p,
                format!("vnp_ResponseCode={response_code}, vnp_TransactionStatus={txn_status}"),
                serde_json::to_string(params).unwrap_or_default(),
            )
            .await?;
        }

        Ok(())
    }

    /// MoMo IPN: POST JSON body.
    pub async fn handle_momo_ipn(&self, payload: &MomoIpnPayload) -> AppResult<()> {
        let verification = self.momo.verify_ipn(payload)?;

        let p = self
            .store
            .payment_store()
            .find_by_txn_ref(&verification.txn_ref)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "payment with txn_ref {} not found",
                    verification.txn_ref
                ))
            })?;

        if statuses::is_terminal(&p.status) {
            tracing::info!(
                payment_id = %p.id,
                txn_ref = %verification.txn_ref,
                status = %p.status,
                "MoMo IPN received for already-terminal payment — no-op"
            );
            return Ok(());
        }

        if verification.result_code == 0 {
            // Success. Verify amount matches.
            if verification.amount != p.amount {
                tracing::error!(
                    payment_id = %p.id,
                    txn_ref = %verification.txn_ref,
                    expected_amount = p.amount,
                    actual_amount = verification.amount,
                    "MoMo IPN amount mismatch — marking payment failed"
                );
                self.mark_failed(
                    &p,
                    format!(
                        "amount mismatch: expected {}, got {}",
                        p.amount, verification.amount
                    ),
                    serde_json::to_string(payload).unwrap_or_default(),
                )
                .await?;
                return Ok(());
            }

            self.mark_completed(
                p,
                Some(verification.trans_id.to_string()),
                serde_json::to_string(payload).unwrap_or_default(),
            )
            .await?;
        } else {
            self.mark_failed(
                &p,
                format!("resultCode={}", verification.result_code),
                serde_json::to_string(payload).unwrap_or_default(),
            )
            .await?;
        }

        Ok(())
    }

    /// ZaloPay callback: POST JSON body, raw bytes needed for MAC verify.
    pub async fn handle_zalopay_callback(
        &self,
        payload: &ZalopayCallbackPayload,
        raw_body: &[u8],
    ) -> AppResult<()> {
        let verification = self.zalopay.verify_callback(payload, raw_body)?;

        // ZaloPay uses `app_trans_id` (yyMMdd_bookingcode) as the txn ref.
        // We stored the booking code in the `app_trans_id`'s second part,
        // so we can look up the payment by parsing it.
        //
        // But to keep things simple, we store our own `provider_txn_ref`
        // at create time — and the callback gives us `app_trans_id`.
        // Look up the payment by `app_trans_id` stored in `provider_response`.
        //
        // Simpler approach: store `app_trans_id` AS the `provider_txn_ref`.
        // Let me adjust the create-payment flow to store it that way.
        let txn_ref = verification.app_trans_id.clone();
        let p = self
            .store
            .payment_store()
            .find_by_txn_ref(&txn_ref)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| {
                AppError::NotFound(format!("payment with txn_ref {txn_ref} not found"))
            })?;

        if statuses::is_terminal(&p.status) {
            tracing::info!(
                payment_id = %p.id,
                txn_ref = %txn_ref,
                status = %p.status,
                "ZaloPay callback received for already-terminal payment — no-op"
            );
            return Ok(());
        }

        // `zp_trans_id > 0` indicates success.
        if verification.zp_trans_id > 0 {
            if verification.amount != p.amount {
                tracing::error!(
                    payment_id = %p.id,
                    txn_ref = %txn_ref,
                    expected_amount = p.amount,
                    actual_amount = verification.amount,
                    "ZaloPay callback amount mismatch — marking payment failed"
                );
                self.mark_failed(
                    &p,
                    format!(
                        "amount mismatch: expected {}, got {}",
                        p.amount, verification.amount
                    ),
                    serde_json::to_string(payload).unwrap_or_default(),
                )
                .await?;
                return Ok(());
            }

            self.mark_completed(
                p,
                Some(verification.zp_trans_id.to_string()),
                serde_json::to_string(payload).unwrap_or_default(),
            )
            .await?;
        } else {
            self.mark_failed(
                &p,
                format!("zp_trans_id={} (non-positive)", verification.zp_trans_id),
                serde_json::to_string(payload).unwrap_or_default(),
            )
            .await?;
        }

        Ok(())
    }

    // ── Admin ops ────────────────────────────────────────────────

    pub async fn list_admin(
        &self,
        status: Option<&str>,
        provider: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> AppResult<AdminPaymentListResponse> {
        let limit = limit.clamp(1, 200);
        let items = self
            .store
            .payment_store()
            .list_admin(status, provider, limit, offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let total = self
            .store
            .payment_store()
            .count_admin(status, provider)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Batch-fetch booking codes for display.
        let booking_ids: Vec<Uuid> = items.iter().map(|p| p.booking_id).collect();
        let bookings: std::collections::HashMap<Uuid, String> = if booking_ids.is_empty() {
            std::collections::HashMap::new()
        } else {
            let booking_models = self
                .store
                .booking_store()
                .find_bookings_by_ids(booking_ids)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            booking_models.into_iter().map(|b| (b.id, b.code)).collect()
        };

        let items: Vec<AdminPaymentOut> = items
            .iter()
            .map(|p| AdminPaymentOut {
                id: p.id,
                booking_id: p.booking_id,
                booking_code: bookings.get(&p.booking_id).cloned(),
                user_id: p.user_id,
                provider: p.provider.clone(),
                status: p.status.clone(),
                amount: p.amount,
                currency: p.currency.clone(),
                created_at: p.created_at.clone(),
                updated_at: p.updated_at.clone(),
                provider_txn_ref: p.provider_txn_ref.clone(),
                provider_trans_id: p.provider_trans_id.clone(),
                gateway_url: p.gateway_url.clone(),
                qr_payload: p.qr_payload.clone(),
                memo: p.memo.clone(),
                provider_response: p.provider_response.clone(),
                failure_reason: p.failure_reason.clone(),
                collected_at: p.collected_at.clone(),
                collected_by: p.collected_by.map(|id| id.to_string()),
            })
            .collect();

        Ok(AdminPaymentListResponse {
            items,
            total: Some(total),
        })
    }

    /// Totals over every payment: how many per status and the money collected.
    pub async fn admin_summary(&self) -> AppResult<AdminPaymentSummary> {
        let rows = self
            .store
            .payment_store()
            .status_totals()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut summary = AdminPaymentSummary::default();
        for (status, count, amount) in rows {
            let count = u64::try_from(count).unwrap_or(0);
            summary.total += count;
            match status.as_str() {
                statuses::PENDING => summary.pending = count,
                statuses::COMPLETED => {
                    summary.completed = count;
                    summary.collected = amount.unwrap_or(0);
                }
                statuses::FAILED => summary.failed = count,
                statuses::CANCELLED => summary.cancelled = count,
                statuses::REFUNDED => summary.refunded = count,
                _ => {}
            }
        }
        Ok(summary)
    }

    pub async fn get_admin(&self, id: Uuid) -> AppResult<AdminPaymentOut> {
        let p = self
            .store
            .payment_store()
            .find_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("payment not found".into()))?;
        let booking_code = self.fetch_booking_code(p.booking_id).await?;
        Ok(AdminPaymentOut {
            id: p.id,
            booking_id: p.booking_id,
            booking_code,
            user_id: p.user_id,
            provider: p.provider.clone(),
            status: p.status.clone(),
            amount: p.amount,
            currency: p.currency.clone(),
            created_at: p.created_at.clone(),
            updated_at: p.updated_at.clone(),
            provider_txn_ref: p.provider_txn_ref.clone(),
            provider_trans_id: p.provider_trans_id.clone(),
            gateway_url: p.gateway_url.clone(),
            qr_payload: p.qr_payload.clone(),
            memo: p.memo.clone(),
            provider_response: p.provider_response.clone(),
            failure_reason: p.failure_reason.clone(),
            collected_at: p.collected_at.clone(),
            collected_by: p.collected_by.map(|id| id.to_string()),
        })
    }

    pub async fn update_status(
        &self,
        id: Uuid,
        status: &str,
        reason: Option<&str>,
    ) -> AppResult<UpdatePaymentStatusResponse> {
        if !statuses::ALL.contains(&status) {
            return Err(AppError::Validation(format!(
                "invalid status: {status} (allowed: {})",
                statuses::ALL.join(", ")
            )));
        }

        let p = self
            .store
            .payment_store()
            .find_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("payment not found".into()))?;

        let now = now_iso();
        let mut active: payment::ActiveModel = p.into();
        active.status = Set(status.to_string());
        active.updated_at = Set(now.clone());
        if let Some(r) = reason {
            active.failure_reason = Set(Some(r.to_string()));
        }
        let updated = self
            .store
            .payment_store()
            .update(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // If admin marks a payment as `completed`, also confirm the booking.
        if status == statuses::COMPLETED {
            let _ = self
                .confirm_paid_booking(updated.booking_id, updated.id, &updated.provider)
                .await;
        }

        Ok(UpdatePaymentStatusResponse {
            payment_id: updated.id,
            status: updated.status,
            reason: updated.failure_reason,
            updated_at: now,
        })
    }

    // ── Internal helpers ─────────────────────────────────────────

    /// The payment's owner: the user stored on the payment, else the
    /// booking's.
    async fn assert_ownership(&self, p: &payment::Model, user_id: Option<&str>) -> AppResult<()> {
        let owner = match p.user_id {
            Some(owner) => Some(owner),
            None => self
                .store
                .booking_store()
                .find_booking_by_id(p.booking_id)
                .await?
                .and_then(|b| b.user_id),
        };
        ensure_owner(owner, user_id)
    }

    pub(crate) async fn cancel_prior_pending_payments(&self, booking_id: Uuid) -> AppResult<()> {
        // Bulk UPDATE: flip all pending payments for this booking to cancelled.
        // Single SQL statement, no N round-trips.
        use crate::entity::payment as p;
        use sea_orm::sea_query::Expr;
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

        let db = self.store.db();
        p::Entity::update_many()
            .col_expr(p::Column::Status, Expr::value(statuses::CANCELLED))
            .col_expr(p::Column::UpdatedAt, Expr::value(now_iso()))
            .col_expr(
                p::Column::FailureReason,
                Expr::value("superseded by new payment".to_string()),
            )
            .filter(p::Column::BookingId.eq(booking_id))
            .filter(p::Column::Status.eq(statuses::PENDING))
            .exec(db)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    async fn mark_completed(
        &self,
        p: payment::Model,
        provider_trans_id: Option<String>,
        provider_response: String,
    ) -> AppResult<()> {
        let now = now_iso();
        let booking_id_str = p.booking_id;
        let provider = p.provider.clone();

        // Transactional: payment UPDATE + booking confirm.
        let db = self.store.db();
        let p_id = p.id;
        let provider_trans_id_clone = provider_trans_id.clone();
        let provider_response_clone = provider_response.clone();
        db.transaction::<_, (), AppError>(|txn| {
            Box::pin(async move {
                use crate::entity::payment as p;
                use sea_orm::sea_query::Expr;
                use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

                p::Entity::update_many()
                    .col_expr(p::Column::Status, Expr::value(statuses::COMPLETED))
                    .col_expr(p::Column::UpdatedAt, Expr::value(now.clone()))
                    .col_expr(
                        p::Column::ProviderTransId,
                        Expr::value(provider_trans_id_clone.clone()),
                    )
                    .col_expr(
                        p::Column::ProviderResponse,
                        Expr::value(provider_response_clone),
                    )
                    .filter(p::Column::Id.eq(p_id))
                    .filter(p::Column::Status.eq(statuses::PENDING))
                    .exec(txn)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?;
                Ok(())
            })
        })
        .await
        .map_err(|e| match e {
            sea_orm::TransactionError::Connection(e) => {
                AppError::Internal(format!("transaction start failed: {e}"))
            }
            sea_orm::TransactionError::Transaction(app_err) => app_err,
        })?;

        // Confirm the booking outside the txn — `booking.confirm()` runs its
        // own transaction; running it nested would require passing the txn
        // handle down, which we explicitly avoid (see CompositeStore::db() docs).
        // A failure is logged and recorded on the payment by the helper.
        let _ = self
            .confirm_paid_booking(booking_id_str, p_id, &provider)
            .await;
        Ok(())
    }

    /// Confirm the booking behind a payment that has been collected. If that
    /// is no longer possible (the booking was cancelled or its seats were
    /// released) the customer has paid for nothing: say so loudly and write
    /// it on the payment so an admin sees it in the payments list.
    async fn confirm_paid_booking(
        &self,
        booking_id: Uuid,
        payment_id: Uuid,
        provider: &str,
    ) -> AppResult<()> {
        let Err(error) = self.booking.confirm_as_system(booking_id, provider).await else {
            return Ok(());
        };
        tracing::error!(
            %payment_id,
            %booking_id,
            %error,
            "payment collected but the booking could not be confirmed — refund or fix by hand"
        );
        use crate::entity::payment as p;
        use sea_orm::sea_query::Expr;
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
        let noted = p::Entity::update_many()
            .col_expr(
                p::Column::FailureReason,
                Expr::value(Some(format!(
                    "paid, but the booking could not be confirmed: {error}"
                ))),
            )
            .col_expr(p::Column::UpdatedAt, Expr::value(now_iso()))
            .filter(p::Column::Id.eq(payment_id))
            .exec(self.store.db())
            .await;
        if let Err(e) = noted {
            tracing::error!(%payment_id, error = %e, "could not record the unconfirmed payment");
        }
        Err(error)
    }

    async fn mark_failed(
        &self,
        p: &payment::Model,
        reason: String,
        provider_response: String,
    ) -> AppResult<()> {
        let id = p.id;
        let now = now_iso();
        // Use a conditional UPDATE to avoid race conditions with concurrent
        // IPN retries — only flips pending → failed, never terminal → failed.
        use crate::entity::payment as p;
        use sea_orm::sea_query::Expr;
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

        let db = self.store.db();
        p::Entity::update_many()
            .col_expr(p::Column::Status, Expr::value(statuses::FAILED))
            .col_expr(p::Column::UpdatedAt, Expr::value(now.clone()))
            .col_expr(p::Column::FailureReason, Expr::value(reason))
            .col_expr(p::Column::ProviderResponse, Expr::value(provider_response))
            .filter(p::Column::Id.eq(id))
            .filter(p::Column::Status.eq(statuses::PENDING))
            .exec(db)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    async fn fetch_booking_code(&self, booking_id: Uuid) -> AppResult<Option<String>> {
        let b = self
            .store
            .booking_store()
            .find_booking_by_id(booking_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(b.map(|b| b.code))
    }

    /// Convert a `payment::Model` to a `PaymentOut` DTO, optionally
    /// attaching the PNG bytes as a data URI.
    fn to_payment_out(&self, p: &payment::Model, qr_image_png: &Option<Vec<u8>>) -> PaymentOut {
        let qr_image_data_uri = qr_image_png.as_ref().map(|bytes| {
            let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
            format!("data:image/png;base64,{b64}")
        });

        // For VietQR, include the bank-transfer instructions.
        let bank_transfer_instructions =
            if p.provider == providers::VIETQR && self.cfg.vietqr.is_active() {
                Some(BankTransferInstructions {
                    bank_bin: self.cfg.vietqr.bank_bin.clone(),
                    bank_name: bank_name_for_bin(&self.cfg.vietqr.bank_bin),
                    account_no: self.cfg.vietqr.account_no.clone(),
                    account_name: self.cfg.vietqr.account_name.clone(),
                    amount: p.amount,
                    memo: p.memo.clone().unwrap_or_default(),
                })
            } else {
                None
            };

        PaymentOut {
            id: p.id,
            booking_id: p.booking_id,
            user_id: p.user_id,
            provider: p.provider.clone(),
            status: p.status.clone(),
            amount: p.amount,
            currency: p.currency.clone(),
            created_at: p.created_at.clone(),
            updated_at: p.updated_at.clone(),
            provider_txn_ref: p.provider_txn_ref.clone(),
            provider_trans_id: p.provider_trans_id.clone(),
            gateway_url: p.gateway_url.clone(),
            qr_payload: p.qr_payload.clone(),
            qr_image_data_uri,
            memo: p.memo.clone(),
            failure_reason: p.failure_reason.clone(),
            collected_at: p.collected_at.clone(),
            collected_by: p.collected_by.map(|id| id.to_string()),
            bank_transfer_instructions,
            return_url: Some(format!(
                "{}/payments/{}/return",
                self.cfg.public_base_url.trim_end_matches('/'),
                p.id
            )),
        }
    }
}

// ────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

/// Map a Vietnamese bank BIN to its display name. Not exhaustive —
/// falls back to the BIN itself for unknown banks.
fn bank_name_for_bin(bin: &str) -> String {
    match bin {
        "970403" => "Sacombank".to_string(),
        "970407" => "Techcombank".to_string(),
        "970409" => "BIDV".to_string(),
        "970415" => "VietinBank".to_string(),
        "970416" => "ACB".to_string(),
        "970418" => "Agribank".to_string(),
        "970422" => "MBBank".to_string(),
        "970423" => "TPBank".to_string(),
        "970429" => "Eximbank".to_string(),
        "970432" => "VPBank".to_string(),
        "970436" => "Vietcombank".to_string(),
        _ => bin.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::test_support::fixture;
    use sea_orm::EntityTrait;

    fn cod(booking_id: Uuid) -> CreatePaymentReq {
        CreatePaymentReq {
            booking_id,
            provider: "cod".into(),
        }
    }

    fn id_of(owner: Uuid) -> String {
        owner.to_string()
    }

    #[tokio::test]
    async fn a_bookings_payments_are_private_to_its_owner() {
        let f = fixture(2).await;
        let (owner, stranger) = (f.owner().await, f.owner().await);
        let held = f.hold(owner, 1).await;
        let (owner_s, stranger_s) = (id_of(owner), id_of(stranger));

        let made = f
            .payments
            .create_payment(&cod(held.booking_id), Some(&owner_s))
            .await
            .unwrap();
        let pid = made.payment.id;

        // Signed out: 401 on every door.
        let anon = |e: AppError| matches!(e, AppError::Unauthorized(_));
        assert!(anon(f.payments.get(pid, None).await.unwrap_err()));
        assert!(anon(
            f.payments
                .list_by_booking(held.booking_id, None)
                .await
                .unwrap_err()
        ));
        assert!(anon(f.payments.cancel(pid, None, None).await.unwrap_err()));
        assert!(anon(
            f.payments
                .create_payment(&cod(held.booking_id), None)
                .await
                .unwrap_err()
        ));

        // Someone else: 403.
        let foreign = |e: AppError| matches!(e, AppError::Forbidden(_));
        assert!(foreign(
            f.payments.get(pid, Some(&stranger_s)).await.unwrap_err()
        ));
        assert!(foreign(
            f.payments
                .list_by_booking(held.booking_id, Some(&stranger_s))
                .await
                .unwrap_err()
        ));
        assert!(foreign(
            f.payments
                .cancel(pid, Some(&stranger_s), None)
                .await
                .unwrap_err()
        ));
        assert!(foreign(
            f.payments
                .create_payment(&cod(held.booking_id), Some(&stranger_s))
                .await
                .unwrap_err()
        ));

        // The owner sees it, and it is in the list.
        assert_eq!(f.payments.get(pid, Some(&owner_s)).await.unwrap().id, pid);
        let listed = f
            .payments
            .list_by_booking(held.booking_id, Some(&owner_s))
            .await
            .unwrap();
        assert_eq!(listed.items.len(), 1);
    }

    #[tokio::test]
    async fn a_cash_payment_places_the_booking_and_collecting_confirms_it() {
        let f = fixture(1).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 1).await;

        let made = f
            .payments
            .create_payment(&cod(held.booking_id), Some(&id_of(owner)))
            .await
            .unwrap();
        // Placed: the seat stays held until departure for the operator's call.
        let b = f.booking(held.booking_id).await;
        assert_eq!(
            (b.status.as_str(), b.payment_method.as_deref()),
            ("pending", Some("cod"))
        );
        assert_eq!(f.seats_now().await, (0, 1, 0, 0));
        assert_eq!(f.payment_status(made.payment.id).await, "pending");
        f.svc.expire_stale_holds(10).await.unwrap();
        assert_eq!(f.booking(held.booking_id).await.status, "pending");

        let admin = Uuid::new_v4();
        f.payments
            .mark_cod_collected(made.payment.id, admin, None, None)
            .await
            .unwrap();
        assert_eq!(f.payment_status(made.payment.id).await, "completed");
        assert_eq!(f.booking(held.booking_id).await.status, "confirmed");
    }

    #[tokio::test]
    async fn checkout_offers_only_the_providers_that_are_set_up() {
        let f = fixture(1).await;
        // The fixture enables cash only; no gateway has credentials.
        assert_eq!(f.payments.enabled_providers().providers, ["cod"]);
    }

    #[tokio::test]
    async fn the_admin_summary_counts_every_payment_and_the_money_collected() {
        let f = fixture(1).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 1).await;
        for status in ["completed", "completed", "pending", "failed"] {
            f.payment(&held, owner, status).await;
        }

        let summary = f.payments.admin_summary().await.unwrap();
        assert_eq!(
            summary,
            AdminPaymentSummary {
                total: 4,
                pending: 1,
                completed: 2,
                failed: 1,
                collected: 2 * held.total,
                ..Default::default()
            }
        );
    }

    #[tokio::test]
    async fn a_new_payment_supersedes_the_previous_pending_one() {
        let f = fixture(1).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 1).await;
        let first = f.payment(&held, owner, "pending").await;
        f.payments
            .cancel_prior_pending_payments(held.booking_id)
            .await
            .unwrap();
        assert_eq!(f.payment_status(first).await, "cancelled");
    }

    #[tokio::test]
    async fn an_expired_booking_cannot_start_a_payment() {
        let f = fixture(1).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 1).await;
        f.age_hold(held.booking_id, 5).await;

        let err = f
            .payments
            .create_payment(&cod(held.booking_id), Some(&id_of(owner)))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Gone(_)), "{err:?}");
        assert_eq!(f.booking(held.booking_id).await.status, "pending");
    }

    #[tokio::test]
    async fn money_taken_for_a_lost_booking_is_flagged_not_swallowed() {
        let f = fixture(1).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 1).await;
        let pay = f.payment(&held, owner, "pending").await;
        f.age_hold(held.booking_id, 5).await;
        f.svc.expire_stale_holds(10).await.unwrap(); // booking cancelled, payment cancelled

        // An admin (or a very late webhook) marks it paid anyway.
        f.payments
            .update_status(pay, "completed", None)
            .await
            .unwrap();

        let row = payment::Entity::find_by_id(pay)
            .one(f.store.db())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.status, "completed");
        let note = row.failure_reason.unwrap_or_default();
        assert!(note.contains("could not be confirmed"), "note: {note}");
        assert_eq!(f.booking(held.booking_id).await.status, "cancelled");
    }
}
