/**
 * Notification helpers — email & SMS.
 *
 * Used to alert employees/admins when a customer sends a chat message but no
 * employee is online to answer ("offline channel" notifications).
 *
 * Provider strategy (auto-detected by env):
 *  - Email:
 *      • Production + RESEND_API_KEY set  → Resend HTTPS API (no SDK needed).
 *      • Otherwise (dev / no key)         → log to console + append to
 *                                            `notifications.log` in project root.
 *  - SMS:
 *      • Production + TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN set
 *                                          → Twilio REST API (no SDK needed).
 *      • Otherwise                         → log to console + append to log file.
 *
 * Both functions are fire-and-forget friendly: they never throw — they always
 * resolve to `{ ok: boolean, error?: string }`.
 */
import { appendFile, mkdir } from 'fs/promises'
import { dirname, join } from 'path'

const IS_PROD = process.env.NODE_ENV === 'production'
const LOG_FILE = join(process.cwd(), 'notifications.log')

async function appendLog(line: string): Promise<void> {
  try {
    await mkdir(dirname(LOG_FILE), { recursive: true })
    await appendFile(LOG_FILE, line + '\n', 'utf8')
  } catch {
    /* swallow */
  }
}

export interface EmailPayload {
  to: string
  subject: string
  text: string
  html?: string
  /** Optional "from" override; defaults to APP_URL-derived address */
  from?: string
}

export interface SendResult {
  ok: boolean
  error?: string
  /** Provider that handled the request (for observability) */
  provider: 'resend' | 'twilio' | 'log'
}

const DEFAULT_FROM = process.env.MAIL_FROM || 'VeXeVN CSKH <no-reply@vexevn.vn>'

/** Send an email via Resend (prod) or log it (dev). */
export async function sendEmail(p: EmailPayload): Promise<SendResult> {
  if (!p.to || !p.subject || !p.text) {
    return { ok: false, error: 'missing-fields', provider: 'log' }
  }

  // ─── Production: Resend ─────────────────────────────────────
  if (IS_PROD && process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: p.from || DEFAULT_FROM,
          to: p.to,
          subject: p.subject,
          text: p.text,
          html: p.html,
        }),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        return { ok: false, error: `resend-${res.status}: ${errText.slice(0, 200)}`, provider: 'resend' }
      }
      return { ok: true, provider: 'resend' }
    } catch (e) {
      return { ok: false, error: (e as Error).message, provider: 'resend' }
    }
  }

  // ─── Dev / no key: log ─────────────────────────────────────
  const line = `[${new Date().toISOString()}] EMAIL → ${p.to} | ${p.subject}\n  ${p.text.replace(/\n/g, '\n  ')}`
  console.log(`📧 ${line}`)
  await appendLog(line)
  return { ok: true, provider: 'log' }
}

export interface SmsPayload {
  to: string
  text: string
}

/** Send an SMS via Twilio (prod) or log it (dev). */
export async function sendSms(p: SmsPayload): Promise<SendResult> {
  if (!p.to || !p.text) {
    return { ok: false, error: 'missing-fields', provider: 'log' }
  }

  // ─── Production: Twilio REST API ───────────────────────────
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  if (IS_PROD && sid && token && from) {
    try {
      const auth = Buffer.from(`${sid}:${token}`).toString('base64')
      const body = new URLSearchParams({ From: from, To: p.to, Body: p.text })
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        return { ok: false, error: `twilio-${res.status}: ${errText.slice(0, 200)}`, provider: 'twilio' }
      }
      return { ok: true, provider: 'twilio' }
    } catch (e) {
      return { ok: false, error: (e as Error).message, provider: 'twilio' }
    }
  }

  // ─── Dev / no creds: log ───────────────────────────────────
  const line = `[${new Date().toISOString()}] SMS → ${p.to} | ${p.text}`
  console.log(`📱 ${line}`)
  await appendLog(line)
  return { ok: true, provider: 'log' }
}

/**
 * Convenience: notify all offline-channel recipients (employees + admins)
 * that a customer is waiting for a reply.
 *
 * Returns the count of successful notifications (email + sms combined).
 * Never throws — caller can `await` without try/catch.
 */
export async function notifyChannelOffline(args: {
  recipients: Array<{ email?: string | null; phone?: string | null; name: string; role?: string | null; brandName?: string | null }>
  channelTopic: string
  channelId: string
  customerName: string
  customerMessage: string
  brandName?: string | null
}): Promise<{ emailed: number; smsed: number; failed: number }> {
  const subject = `[VeXeVN] Khách đang chờ hỗ trợ — ${args.channelTopic}`
  const textBody = [
    `Có khách hàng đang chờ phản hồi trên kênh chat nhưng chưa có nhân viên trực tuyến.`,
    ``,
    `Kênh: ${args.channelTopic} (${args.channelId})`,
    args.brandName ? `Hãng: ${args.brandName}` : null,
    `Khách hàng: ${args.customerName}`,
    `Tin nhắn: "${args.customerMessage.slice(0, 280)}"`,
    ``,
    `Vui lòng đăng nhập vào hệ thống và phản hồi khách ngay.`,
    `https://${process.env.APP_URL?.replace(/^https?:\/\//, '') || 'vexevn.vn'}/?view=admin`,
  ].filter(Boolean).join('\n')

  const htmlBody = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
  <h2 style="color:#dc2626;margin:0 0 12px">⚠️ Khách đang chờ hỗ trợ</h2>
  <p>Có khách hàng đang chờ phản hồi trên kênh chat nhưng chưa có nhân viên trực tuyến.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
    <tr><td style="padding:6px 0;color:#64748b;width:120px">Kênh</td><td style="padding:6px 0;font-weight:600">${args.channelTopic}</td></tr>
    ${args.brandName ? `<tr><td style="padding:6px 0;color:#64748b">Hãng</td><td style="padding:6px 0;font-weight:600">${args.brandName}</td></tr>` : ''}
    <tr><td style="padding:6px 0;color:#64748b">Khách hàng</td><td style="padding:6px 0;font-weight:600">${args.customerName}</td></tr>
  </table>
  <div style="background:#f1f5f9;border-left:3px solid #0ea5e9;padding:12px 16px;margin:16px 0;border-radius:4px">
    "${args.customerMessage.slice(0, 280)}"
  </div>
  <a href="https://${process.env.APP_URL?.replace(/^https?:\/\//, '') || 'vexevn.vn'}/?view=admin" style="display:inline-block;background:#0ea5e9;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Đăng nhập &amp; phản hồi</a>
</div>`

  const results = await Promise.allSettled(
    args.recipients.flatMap((r) => {
      const tasks: Promise<SendResult>[] = []
      if (r.email) tasks.push(sendEmail({ to: r.email, subject, text: textBody, html: htmlBody }))
      if (r.phone) tasks.push(sendSms({ to: r.phone, text: `[VeXeVN] Khách "${args.customerName}" đang chờ hỗ trợ trên kênh "${args.channelTopic}". Vui lòng đăng nhập để phản hồi.` }))
      return tasks
    }),
  )

  let emailed = 0
  let smsed = 0
  let failed = 0
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.ok) {
      if (r.value.provider === 'twilio') smsed++
      else if (r.value.provider === 'resend') emailed++
      else { emailed++; smsed++ } // log provider counts for both
    } else {
      failed++
    }
  }
  return { emailed, smsed, failed }
}
