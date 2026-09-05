import { render, screen, within, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for the three-role system's admin Users panel:
 *   - renders users with their role badges (user / employee / admin)
 *   - admins see the role-change select; employees never do
 *   - bots + the admin themself cannot have their role changed
 */

vi.mock('@/lib/queries', () => {
  return {
    useUsers: vi.fn(),
    useSetUserRole: vi.fn(() => ({
      isPending: false,
      mutateAsync: vi.fn(),
    })),
  }
})

/** Mutable mock state — each test can switch the logged-in persona. */
const mockState: { user: { id: string; type: string; name: string } | null } = {
  user: { id: 'admin-1', type: 'admin', name: 'Root Admin' },
}

vi.mock('@/lib/store', () => {
  return {
    useApp: () => mockState,
    isStaffUser: (u: { type: string } | null | undefined) =>
      u?.type === 'employee' || u?.type === 'admin',
    hydrateFromStorage: vi.fn(),
  }
})

import { useUsers } from '@/lib/queries'
import { UsersPanel } from '../users-panel'

const fetchMock = useUsers as unknown as ReturnType<typeof vi.fn>

function mockQueryResult(items: unknown[], total = items.length) {
  return {
    data: { items, total },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }
}

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
    mockState.user = { id: 'admin-1', type: 'admin', name: 'Root Admin' }
  })
  it('renders users with role badges for each of the three roles', async () => {
    fetchMock.mockReturnValue(mockQueryResult(USERS))

    render(<UsersPanel />)

    const table = await screen.findByTestId('users-table')
    expect(within(table).getByText('Root Admin')).toBeInTheDocument()
    expect(within(table).getByText('Quản trị')).toBeInTheDocument()
    expect(within(table).getByText('Nhân viên')).toBeInTheDocument()
    expect(within(table).getAllByText('Khách hàng').length).toBeGreaterThan(0)
    // Bot row shows the BOT marker and never a role-change select.
    expect(within(table).getByText('BOT')).toBeInTheDocument()
  })

  it('offers role-change selects for non-bot, non-self rows (admin view)', async () => {
    fetchMock.mockReturnValue(mockQueryResult(USERS))

    render(<UsersPanel />)

    await screen.findByTestId('users-table')
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
    // Re-mock the store with an employee user (mutable module-level
    // state, hoisted into the factory above).
    mockState.user = { id: 'emp-1', type: 'employee', name: 'Nguyễn Văn A' }
    fetchMock.mockReturnValue(mockQueryResult(USERS))

    render(<UsersPanel />)
    await screen.findByTestId('users-table')
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('shows the pagination footer with the server total', async () => {
    fetchMock.mockReturnValue(
      mockQueryResult(USERS, 47), // 47 total → "trang 1 / 3"
    )

    render(<UsersPanel />)

    const table = await screen.findByTestId('users-table')
    await waitFor(() => {
      expect(within(table).getByText(/47/)).toBeInTheDocument()
    })
  })
})
