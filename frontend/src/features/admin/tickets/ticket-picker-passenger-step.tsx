'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ComboboxField } from '@/components/ui/combobox'
import { User, Armchair, Sparkles } from 'lucide-react'
import { useT } from '@/lib/i18n'
import type { Passenger } from './chat-ticket-picker-types'

// ── PassengerStep ───────────────────────────────────────────

export function PassengerStep({
  passengers,
  setPassengers,
  contactName,
  contactPhone,
  contactEmail,
  setContactName,
  setContactPhone,
  setContactEmail,
  autoConfirm,
  setAutoConfirm,
}: {
  passengers: Passenger[]
  setPassengers: (updater: (prev: Passenger[]) => Passenger[]) => void
  contactName: string
  contactPhone: string
  contactEmail: string
  setContactName: (v: string) => void
  setContactPhone: (v: string) => void
  setContactEmail: (v: string) => void
  autoConfirm: boolean
  setAutoConfirm: (v: boolean) => void
}) {
  const t = useT()
  return (
    <div className="space-y-3">
      {/* Contact info */}
      <div className="rounded-lg border p-3 bg-slate-50/50">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <User className="h-3.5 w-3.5" /> {t('booking.contactInfo')}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase">{t('adminTickets.bookerName')}</Label>
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder={t('adminTickets.nameExample')}
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase">{t('adminTickets.phoneLabel')}</Label>
            <Input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="09xx xxx xxx"
              className="h-9"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-[10px] text-muted-foreground uppercase">{t('adminTickets.emailOptional')}</Label>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="email@example.com"
              className="h-9"
            />
          </div>
        </div>
      </div>

      {/* Passengers per seat */}
      <div className="rounded-lg border p-3">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <Armchair className="h-3.5 w-3.5" /> {t('adminTickets.passengersBySeat')}
        </div>
        {passengers.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">
            {t('adminTickets.noSeatsSelected')}
          </div>
        ) : (
          <div className="space-y-2">
            {passengers.map((p) => (
              <div key={p.seatId} className="flex items-center gap-2 rounded-md bg-slate-50 p-2">
                <Badge variant="outline" className="font-mono text-[10px] bg-white">
                  {p.seatCode}
                </Badge>
                <Input
                  value={p.name}
                  onChange={(e) =>
                    setPassengers((prev) =>
                      prev.map((x) =>
                        x.seatId === p.seatId ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder={t('adminTickets.passengerNamePh')}
                  className="h-8 flex-1 text-xs"
                />
                <ComboboxField
                  value={p.type}
                  onValueChange={(v) =>
                    setPassengers((prev) =>
                      prev.map((x) =>
                        x.seatId === p.seatId
                          ? { ...x, type: v as 'adult' | 'child' | 'infant' }
                          : x,
                      ),
                    )
                  }
                  items={[
                    { value: 'adult', label: t('booking.passengerType.adult') },
                    { value: 'child', label: t('booking.passengerType.child') },
                    { value: 'infant', label: t('booking.passengerType.infant') },
                  ]}
                  className="h-8 w-25 text-xs"
                  placeholder={t('adminTickets.typeLabel')}
                  searchPlaceholder={t('combobox.search')}
                  aria-label={t('adminTickets.passengerTypeAria')}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auto-confirm */}
      <label className="flex items-center gap-2 cursor-pointer rounded-lg border p-3 bg-emerald-50/30">
        <input
          type="checkbox"
          checked={autoConfirm}
          onChange={(e) => setAutoConfirm(e.target.checked)}
          className="h-4 w-4 rounded"
        />
        <div className="flex-1">
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
            {t('adminTickets.autoConfirmTitle')}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t('adminTickets.autoConfirmDesc')}
          </div>
        </div>
      </label>
    </div>
  )
}
