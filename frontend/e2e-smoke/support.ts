import { createHmac, randomUUID } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'
import { expect, type BrowserContext, type Page } from '@playwright/test'

/** The pbkdf2 account of the fixture (made by the Worker; `tests/fixtures/wp6_ref_auth.json`). */
export const CUSTOMER = { email: 'worker.user@example.com', password: 'mật-khẩu Ü 123' }

/** The fixture's admin (`tests/fixtures/d1/synthetic.sql`). */
const ADMIN_ID = process.env.SMOKE_ADMIN_ID ?? 'ad4d2fd8-e325-51db-aad6-1d6643cce992'
const JWT_SECRET = process.env.SMOKE_JWT_SECRET ?? 'local-parity-secret-at-least-32-bytes-long-aaaa'

const b64u = (value: string) => Buffer.from(value).toString('base64url')

/** An access token the server accepts: HS256 over `{typ, sub, iss, iat, exp, jti}`. */
function accessToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000)
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64u(
    JSON.stringify({
      typ: 'access',
      sub: userId,
      iss: 'backend',
      iat: now,
      exp: now + 3600,
      jti: randomUUID(),
    }),
  )
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

/** Signs the browser in as the fixture's admin (no password involved). */
export async function signInAsAdmin(context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'access_token', value: accessToken(ADMIN_ID), url: baseURL }])
}

/** The sign-in form, as a customer. Lands on the account page. */
export async function signInAsCustomer(page: Page) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email *' }).fill(CUSTOMER.email)
  await page.getByRole('textbox', { name: 'Mật khẩu *' }).fill(CUSTOMER.password)
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
  await expect(page).toHaveURL(/\/account/)
}

/** `YYYY-MM-DD` in Vietnam, `days` from today. */
export function vnDate(days: number): string {
  return new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10)
}

/** The Hà Nội → Đà Nẵng results page for a day. */
export function searchUrl(days: number): string {
  const params = new URLSearchParams({ from: 'Hà Nội', to: 'Đà Nẵng', date: vnDate(days) })
  return `/search?${params}`
}

/** A valid RGB PNG (a gradient): what an admin would pick as a route picture. */
export function gradientPng(width = 800, height = 600): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), out.length - 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8-bit RGB, no interlace
  const rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) {
      rows.set(
        [(x * 255) / width, (y * 255) / height, 160].map((v) => Math.floor(v)),
        row + 1 + x * 3,
      )
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
