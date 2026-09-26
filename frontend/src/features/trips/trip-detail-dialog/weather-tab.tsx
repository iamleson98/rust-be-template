'use client'

/**
 * WeatherTab — "Thời tiết" tab inside the TripDetailDialog.
 *
 * Renders a deterministic mock weather forecast (current conditions +
 * 3-day forecast + suggested items) seeded by destination + arrival
 * date. The mock is stable so the same destination/date always shows
 * the same forecast.
 *
 * Extracted verbatim from the original `trip-detail-dialog.tsx`
 * (lines 929-1168). Pure refactor.
 */

import { useMemo } from 'react'
import {
  Cloud,
  CloudRain,
  CloudSun,
  Sun,
  Wind,
  Umbrella,
  Thermometer,
  Droplet,
  Droplets,
  CalendarDays,
  Lightbulb,
  CheckCircle2,
} from 'lucide-react'
import { formatTimeVN, formatDateVN } from '@/lib/types'
import { useT } from '@/lib/i18n'

type WeatherCondition = 'sunny' | 'partly_cloudy' | 'cloudy' | 'rainy'

type Weather = {
  today: {
    temp: number
    condition: WeatherCondition
    humidity: number
    wind: number
    feelsLike: number
  }
  forecast: {
    date: string
    dayLabel: string
    condition: WeatherCondition
    tempMax: number
    tempMin: number
    humidity: number
    wind: number
  }[]
}

function conditionLabel(condition: WeatherCondition, t: ReturnType<typeof useT>): string {
  switch (condition) {
    case 'sunny':
      return t('tripDetail.weatherSunny')
    case 'partly_cloudy':
      return t('tripDetail.weatherPartlyCloudy')
    case 'cloudy':
      return t('tripDetail.weatherCloudy')
    case 'rainy':
      return t('tripDetail.weatherRainy')
  }
}

function ConditionIcon({ condition, className }: { condition: WeatherCondition; className?: string }) {
  switch (condition) {
    case 'sunny':
      return <Sun className={className} />
    case 'partly_cloudy':
      return <CloudSun className={className} />
    case 'cloudy':
      return <Cloud className={className} />
    case 'rainy':
      return <CloudRain className={className} />
  }
}

function ConditionColor(condition: WeatherCondition): string {
  switch (condition) {
    case 'sunny':
      return 'text-amber-500 bg-amber-50'
    case 'partly_cloudy':
      return 'text-blue-500 bg-blue-50'
    case 'cloudy':
      return 'text-slate-500 bg-slate-100'
    case 'rainy':
      return 'text-blue-800 bg-blue-50'
  }
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (s.charCodeAt(i) + ((h << 5) - h)) | 0
  }
  return Math.abs(h)
}

function getWeather(destination: string, arrivalDate: string): Weather {
  const baseKey = `${destination}|${arrivalDate.slice(0, 10)}`
  const seed = hashString(baseKey)
  const conditions: WeatherCondition[] = ['sunny', 'partly_cloudy', 'cloudy', 'rainy']

  const todayCondition = conditions[seed % conditions.length]
  const todayTemp = 18 + (seed % 18) // 18-35
  const todayHumidity = 40 + (seed % 56) // 40-95
  const todayWind = 5 + (seed % 26) // 5-30
  const todayFeelsLike = todayTemp + (todayHumidity > 70 ? 2 : -1)

  const arrival = new Date(arrivalDate)
  const forecast = Array.from({ length: 3 }).map((_, i) => {
    const s = hashString(baseKey + ':' + i)
    const d = new Date(arrival.getTime() + i * 24 * 60 * 60 * 1000)
    return {
      date: d.toISOString(),
      dayLabel: new Intl.DateTimeFormat('vi-VN', { weekday: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(d),
      condition: conditions[s % conditions.length],
      tempMax: 22 + (s % 14),
      tempMin: 16 + (s % 10),
      humidity: 40 + (s % 56),
      wind: 5 + (s % 26),
    }
  })

  return {
    today: {
      temp: todayTemp,
      condition: todayCondition,
      humidity: todayHumidity,
      wind: todayWind,
      feelsLike: todayFeelsLike,
    },
    forecast,
  }
}

export function WeatherTab({ destination, arrivalDate }: { destination: string; arrivalDate: string }) {
  const t = useT()
  const weather = useMemo(() => getWeather(destination, arrivalDate), [destination, arrivalDate])

  // Suggested items based on weather
  const suggestions = useMemo(() => {
    const items: { icon: React.ReactNode; label: string; reason: string }[] = []
    if (weather.today.condition === 'rainy') {
      items.push({ icon: <Umbrella className="h-4 w-4" />, label: t('tripDetail.suggestUmbrella'), reason: t('tripDetail.suggestUmbrellaReason') })
    }
    if (weather.today.temp < 22) {
      items.push({ icon: <Thermometer className="h-4 w-4" />, label: t('tripDetail.suggestJacket'), reason: t('tripDetail.suggestJacketReason', { temp: weather.today.temp }) })
    }
    if (weather.today.condition === 'sunny' || weather.today.temp > 30) {
      items.push({ icon: <Sun className="h-4 w-4" />, label: t('tripDetail.suggestSunscreen'), reason: t('tripDetail.suggestSunscreenReason') })
    }
    if (weather.today.temp > 30) {
      items.push({ icon: <Droplet className="h-4 w-4" />, label: t('tripDetail.suggestWater'), reason: t('tripDetail.suggestWaterReason') })
    }
    if (weather.today.humidity > 80) {
      items.push({ icon: <Wind className="h-4 w-4" />, label: t('tripDetail.suggestMask'), reason: t('tripDetail.suggestMaskReason') })
    }
    if (weather.today.wind > 20) {
      items.push({ icon: <Wind className="h-4 w-4" />, label: t('tripDetail.suggestWindbreaker'), reason: t('tripDetail.suggestWindbreakerReason') })
    }
    if (items.length === 0) {
      items.push({ icon: <CheckCircle2 className="h-4 w-4" />, label: t('tripDetail.suggestComfortable'), reason: t('tripDetail.suggestComfortableReason') })
    }
    return items
  }, [weather, t])

  return (
    <div className="space-y-5">
      {/* Current weather */}
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
          <Cloud className="h-4 w-4 text-blue-700" />
          {t('tripDetail.weatherAt', { destination })}
        </h3>
        <div className="rounded-xl bg-linear-to-br from-blue-50 to-blue-50 ring-1 ring-blue-200/50 p-5">
          <div className="flex items-center gap-4">
            <div
              className={`h-16 w-16 rounded-2xl inline-flex items-center justify-center ${ConditionColor(weather.today.condition)}`}
            >
              <ConditionIcon condition={weather.today.condition} className="h-9 w-9" />
            </div>
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-slate-800">{weather.today.temp}°</span>
                <span className="text-sm font-semibold text-muted-foreground">{conditionLabel(weather.today.condition, t)}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t('tripDetail.weatherFeels', { temp: weather.today.feelsLike, destination, time: formatTimeVN(arrivalDate) })}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-blue-200/40">
            <div className="text-center">
              <Droplets className="h-4 w-4 text-blue-500 mx-auto mb-1" />
              <div className="text-xs text-muted-foreground">{t('tripDetail.humidityLabel')}</div>
              <div className="font-bold text-sm">{weather.today.humidity}%</div>
            </div>
            <div className="text-center">
              <Wind className="h-4 w-4 text-blue-500 mx-auto mb-1" />
              <div className="text-xs text-muted-foreground">{t('tripDetail.windLabel')}</div>
              <div className="font-bold text-sm">{weather.today.wind} km/h</div>
            </div>
            <div className="text-center">
              <Thermometer className="h-4 w-4 text-blue-500 mx-auto mb-1" />
              <div className="text-xs text-muted-foreground">{t('tripDetail.feelsLikeLabel')}</div>
              <div className="font-bold text-sm">{weather.today.feelsLike}°C</div>
            </div>
          </div>
        </div>
      </div>

      {/* 3-day forecast */}
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
          <CalendarDays className="h-4 w-4 text-blue-700" />
          {t('tripDetail.forecast3Days')}
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {weather.forecast.map((f, i) => (
            <div
              key={i}
              className="rounded-xl border bg-white p-3 text-center"
            >
              <div className="text-xs font-semibold uppercase text-muted-foreground">{f.dayLabel}</div>
              <div className="text-[10px] text-muted-foreground mb-2">
                {formatDateVN(f.date, { day: '2-digit', month: '2-digit' })}
              </div>
              <div className={`h-10 w-10 rounded-full inline-flex items-center justify-center mb-2 ${ConditionColor(f.condition)}`}>
                <ConditionIcon condition={f.condition} className="h-5 w-5" />
              </div>
              <div className="font-bold text-sm">
                {f.tempMax}° <span className="text-muted-foreground font-normal text-xs">/ {f.tempMin}°</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">{conditionLabel(f.condition, t)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Suggested items */}
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          {t('tripDetail.suggestedItems')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {suggestions.map((s, i) => (
            <div
              key={i}
              className="flex items-center gap-2.5 rounded-lg border bg-white p-3"
            >
              <div className="h-8 w-8 rounded-lg bg-amber-50 text-amber-700 inline-flex items-center justify-center shrink-0">
                {s.icon}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-sm">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.reason}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[10px] text-muted-foreground italic text-center pt-2">
        {t('tripDetail.weatherDisclaimer')}
      </div>
    </div>
  )
}
