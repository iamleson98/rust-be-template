import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mockApi, renderWithQuery } from '@/test/api'
import { BusLayoutDialog } from '../bus-layout-dialog'

const car = {
  id: 'car_4',
  name: 'Xe 4 chỗ',
  vehicleType: 'standard',
  capacity: 3,
  description: 'Ghế phụ và hàng ghế sau',
  plan: {
    decks: [
      {
        rows: 2,
        cols: 3,
        cells: [
          { row: 1, col: 1, kind: 'driver' },
          { row: 1, col: 3, kind: 'seat', label: '01' },
          { row: 2, col: 1, kind: 'seat', label: '02' },
          { row: 2, col: 3, kind: 'seat', label: '03' },
        ],
      },
    ],
  },
}

const LISTS = {
  'GET /api/admin/brands': { items: [], total: 0 },
  'GET /api/admin/vehicle-types': { items: [{ id: 'v1', code: 'standard', label: 'Ghế ngồi' }] },
  'GET /api/admin/bus-layouts/presets': { items: [car] },
}

/** Requests with a body, recorded so tests can read them after the fact. */
function recorder() {
  const sent: { method: string; path: string; request: Request }[] = []
  const handler = (response: unknown) => (url: URL, request: Request) => {
    sent.push({ method: request.method, path: url.pathname, request: request.clone() })
    return response
  }
  return { sent, handler, body: (i: number) => sent[i].request.json() }
}

describe('BusLayoutDialog — create', () => {
  it('starts from a template, keeps its vehicle type, and saves the plan', async () => {
    const rec = recorder()
    mockApi({ ...LISTS, 'POST /api/admin/bus-layouts': rec.handler({ id: 'new-1' }) })
    const onSaved = vi.fn()
    renderWithQuery(<BusLayoutDialog open layout={null} onOpenChange={vi.fn()} onSaved={onSaved} />)

    await userEvent.click(await screen.findByRole('button', { name: /Xe 4 chỗ/ }))

    // the template's name and vehicle type seed the form; its seats fill the editor
    expect(await screen.findByDisplayValue('Xe 4 chỗ')).toBeInTheDocument()
    expect(screen.getByText('Tổng số chỗ').nextSibling).toHaveTextContent('3')
    expect(screen.getByRole('button', { name: /02/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Thêm sơ đồ' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const body = await rec.body(0)
    expect(body).toMatchObject({ name: 'Xe 4 chỗ', vehicleType: 'standard' })
    expect(body.plan.decks[0].cells).toHaveLength(4)
    expect(body.seatGrid).toBeUndefined()
  })

  it('refuses to save a plan with a duplicated label', async () => {
    const rec = recorder()
    mockApi({ ...LISTS, 'POST /api/admin/bus-layouts': rec.handler({ id: 'x' }) })
    renderWithQuery(<BusLayoutDialog open layout={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /Xe 4 chỗ/ }))

    await userEvent.click(await screen.findByRole('button', { name: /03/ }))
    const label = screen.getByLabelText('Nhãn')
    await userEvent.clear(label)
    await userEvent.type(label, '01')

    expect(await screen.findByRole('alert')).toHaveTextContent('Nhãn "01" bị trùng')
    expect(screen.getByRole('button', { name: 'Thêm sơ đồ' })).toBeDisabled()
    expect(rec.sent).toHaveLength(0)
  })
})

describe('BusLayoutDialog — edit', () => {
  const layout = { id: 'l1', name: 'Giường nằm 40', planned: false, totalSeats: 2 }
  const detail = {
    id: 'l1',
    name: 'Giường nằm 40',
    vehicleType: 'sleeper',
    inUse: true,
    planned: false,
    plan: car.plan,
  }

  it('explains a legacy, in-use layout and saves only what changed', async () => {
    const rec = recorder()
    mockApi({
      ...LISTS,
      'GET /api/admin/bus-layouts/l1': detail,
      'PUT /api/admin/bus-layouts/l1': rec.handler({ id: 'l1' }),
      'PUT /api/admin/bus-layouts/l1/plan': rec.handler({ id: 'l1' }),
    })
    const onSaved = vi.fn()
    renderWithQuery(
      <BusLayoutDialog open layout={layout as never} onOpenChange={vi.fn()} onSaved={onSaved} />,
    )

    expect(
      await screen.findByText(/Sơ đồ này được tạo theo kiểu lưới đơn giản/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Sơ đồ đã có chuyến hoặc vé sử dụng/)).toBeInTheDocument()

    const name = screen.getByLabelText(/Tên sơ đồ/)
    await userEvent.clear(name)
    await userEvent.type(name, 'Giường nằm 40 mới')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    // metadata only: an untouched plan is never re-sent
    expect(rec.sent.map((r) => `${r.method} ${r.path}`)).toEqual(['PUT /api/admin/bus-layouts/l1'])
    expect(await rec.body(0)).toMatchObject({ name: 'Giường nằm 40 mới', vehicleType: 'sleeper' })
  })

  it('sends the plan through the plan endpoint once it was edited', async () => {
    const rec = recorder()
    mockApi({
      ...LISTS,
      'GET /api/admin/bus-layouts/l1': { ...detail, inUse: false },
      'PUT /api/admin/bus-layouts/l1/plan': rec.handler({ id: 'l1' }),
    })
    const onSaved = vi.fn()
    renderWithQuery(
      <BusLayoutDialog open layout={layout as never} onOpenChange={vi.fn()} onSaved={onSaved} />,
    )

    await userEvent.click(await screen.findByRole('button', { name: /Xoá ô/ }))
    await userEvent.click(await screen.findByRole('button', { name: /03/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(rec.sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      'PUT /api/admin/bus-layouts/l1/plan',
    ])
    expect((await rec.body(0)).plan.decks[0].cells).toHaveLength(3)
  })
})
