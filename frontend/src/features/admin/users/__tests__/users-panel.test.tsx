import { screen, within, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionUser } from '@/api'
import { useSession } from '@/stores/session'
import { mockApi, renderWithQuery } from '@/test/api'
import { UsersPanel } from '../users-panel'

/**
 * Tests for the three-role system's admin Users panel:
 *   - renders users with their role badges (user / employee / admin)
 *   - admins see the role-change select; employees never do
 *   - bots + the admin themself cannot have their role changed
 */

const LIST = 'GET /api/users'

const persona = (role: 'admin' | 'employee'): SessionUser => ({
  id: role === 'admin' ? 'admin-1' : 'emp-1',
  type: role,
  role,
  name: role === 'admin' ? 'Root Admin' : 'Nguyễn Văn A',
})

const USERS = [
  {
    id: 'admin-1',
    fullName: 'Root Admin',
    email: 'root@example.com',
    role: 'admin',
    isBot: false,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'emp-1',
    fullName: 'Nguyễn Văn A',
    email: 'a@example.com',
    role: 'employee',
    isBot: false,
    status: 'active',
    createdAt: '2026-02-01T00:00:00Z',
  },
  {
    id: 'usr-1',
    fullName: 'Trần Thị B',
    email: 'b@example.com',
    role: 'user',
    isBot: false,
    status: 'active',
    createdAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'bot-1',
    fullName: 'nullclaw_agent',
    email: 'nullclaw_agent@example.com',
    role: 'user',
    isBot: true,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
]

describe('UsersPanel (three-role management)', () => {
  beforeEach(() => {
    useSession.setState({ user: persona('admin') })
  })
  it('renders users with role badges for each of the three roles', async () => {
    mockApi({ [LIST]: { items: USERS, total: USERS.length } })

    renderWithQuery(<UsersPanel />)

    const table = await screen.findByTestId('users-table')
    expect(await within(table).findByText('Root Admin')).toBeInTheDocument()
    expect(within(table).getByText('Quản trị')).toBeInTheDocument()
    expect(within(table).getByText('Nhân viên')).toBeInTheDocument()
    expect(within(table).getAllByText('Khách hàng').length).toBeGreaterThan(0)
    // Bot row shows the BOT marker and never a role-change select.
    expect(within(table).getByText('BOT')).toBeInTheDocument()
  })

  it('offers role-change selects for non-bot, non-self rows (admin view)', async () => {
    mockApi({ [LIST]: { items: USERS, total: USERS.length } })

    renderWithQuery(<UsersPanel />)

    await screen.findByText('Trần Thị B')
    // Employee + plain user rows get a select; the admin themself and
    // the bot do not. Identified by per-row aria-label (Radix renders
    // exactly one combobox per Select).
    const selects = screen.getAllByLabelText(/^Đổi vai trò/)
    expect(selects.map((el) => el.getAttribute('aria-label'))).toEqual([
      'Đổi vai trò của Nguyễn Văn A',
      'Đổi vai trò của Trần Thị B',
    ])
  })

  it('hides all role-change selects for employees', async () => {
    useSession.setState({ user: persona('employee') })
    mockApi({ [LIST]: { items: USERS, total: USERS.length } })

    renderWithQuery(<UsersPanel />)
    await screen.findByText('Trần Thị B')
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('shows the pagination footer with the server total', async () => {
    mockApi({ [LIST]: { items: USERS, total: 47 } }) // 47 total → "trang 1 / 3"

    renderWithQuery(<UsersPanel />)

    const table = await screen.findByTestId('users-table')
    await waitFor(() => {
      expect(within(table).getByText(/47/)).toBeInTheDocument()
    })
  })
})
