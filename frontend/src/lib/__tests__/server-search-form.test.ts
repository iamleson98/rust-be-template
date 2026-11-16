import { beforeEach, describe, expect, it } from 'vitest'
import { carryOverServerSearchForm } from '@/lib/server-search-form'
import { useSearchForm } from '@/stores/search-form'

/** The form the server writes (`src/web/content.rs`), prefilled as it would be. */
function page(values: { from?: string; to?: string; date?: string } = {}) {
  const root = document.createElement('div')
  root.innerHTML = `<form action="/search" method="get">
    <input name="from" type="text" value="${values.from ?? ''}" />
    <input name="to" type="text" value="${values.to ?? ''}" />
    <input name="date" type="date" value="${values.date ?? '2026-12-02'}" />
  </form>`
  return root
}
const input = (root: HTMLElement, name: string) =>
  root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!

describe('carryOverServerSearchForm', () => {
  beforeEach(() => {
    localStorage.clear()
    useSearchForm.getState().setSearchParams({ from: 'Huế', to: '', date: '2026-11-20' })
  })

  it('moves what the visitor typed into the search store', () => {
    const root = page()
    input(root, 'from').value = ' Hà Nội '
    input(root, 'to').value = 'Hải Phòng'
    carryOverServerSearchForm(root)
    const params = useSearchForm.getState().searchParams
    expect([params.from, params.to]).toEqual(['Hà Nội', 'Hải Phòng'])
  })

  it('leaves alone what the visitor did not touch, defaults included', () => {
    const root = page()
    input(root, 'to').value = 'Đà Nẵng'
    carryOverServerSearchForm(root)
    const params = useSearchForm.getState().searchParams
    expect(params.from).toBe('Huế')
    expect(params.date).toBe('2026-11-20')
    expect(params.to).toBe('Đà Nẵng')
  })

  it('does nothing without a form or without a change', () => {
    carryOverServerSearchForm(document.createElement('div'))
    carryOverServerSearchForm(page({ from: 'Hà Nội' }))
    expect(useSearchForm.getState().searchParams.from).toBe('Huế')
  })
})
