'use client'

/**
 * Geometry → SVG projection for the live-tracking map: projects the
 * route polyline + pickup points into the 600×360 SVG viewBox, finds
 * the interpolated bus position along the path, and builds the
 * traveled-portion path.
 *
 * Extracted from the original 'live-tracking.tsx'.
 */

import { useMemo } from 'react'
import type { TripDetail } from './live-tracking-types'

// Find position at progress (0-1) along the path (pure function)
function positionAt(
  progress: number,
  points: [number, number][],
  totalLength: number,
  cumLengths: number[]
): [number, number] {
  if (points.length === 0) return [300, 180]
  if (progress <= 0) return points[0]
  if (progress >= 1) return points[points.length - 1]
  if (totalLength === 0) return points[0]
  const targetDist = progress * totalLength
  for (let i = 1; i < cumLengths.length; i++) {
    if (cumLengths[i] >= targetDist) {
      const segStart = cumLengths[i - 1]
      const segEnd = cumLengths[i]
      const segLen = segEnd - segStart
      if (segLen === 0) return points[i]
      const t = (targetDist - segStart) / segLen
      const [x1, y1] = points[i - 1]
      const [x2, y2] = points[i]
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)]
    }
  }
  return points[points.length - 1]
}

export function useLiveTrackingProjection(detail: TripDetail, progress: number) {
  // Project geometry (lat/lon) → SVG (x,y) coordinates
  const { points, viewBox, totalLength, cumLengths, stops, pathD } = useMemo(() => {
    const geometry = detail.route.geometry ?? []
    const pickupPoints = detail.pickupPoints ?? []
    if (!geometry || geometry.length === 0) {
      return {
        points: [] as [number, number][],
        viewBox: '0 0 600 360',
        totalLength: 0,
        cumLengths: [0],
        stops: [] as (TripDetail['pickupPoints'][number] & { xy: [number, number] })[],
        pathD: '',
      }
    }
    const allPts = [
      ...geometry,
      ...pickupPoints.map((p) => [p.lat, p.lon] as [number, number]),
    ]
    const lats = allPts.map((p) => p[0])
    const lons = allPts.map((p) => p[1])
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    const latRange = Math.max(maxLat - minLat, 0.01)
    const lonRange = Math.max(maxLon - minLon, 0.01)

    const W = 600
    const H = 360
    const pad = 40
    const project = ([lat, lon]: [number, number]): [number, number] => [
      pad + ((lon - minLon) / lonRange) * (W - 2 * pad),
      pad + ((maxLat - lat) / latRange) * (H - 2 * pad),
    ]

    const routePoints = geometry.map(project)
    const stopPts = pickupPoints.map((p) => ({ ...p, xy: project([p.lat, p.lon]) }))

    // Cumulative segment lengths along the path
    const cumLengths = [0]
    let totalLength = 0
    for (let i = 1; i < routePoints.length; i++) {
      const dx = routePoints[i][0] - routePoints[i - 1][0]
      const dy = routePoints[i][1] - routePoints[i - 1][1]
      totalLength += Math.sqrt(dx * dx + dy * dy)
      cumLengths.push(totalLength)
    }

    const pathD = routePoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
      .join(' ')

    return {
      points: routePoints,
      viewBox: `0 0 ${W} ${H}`,
      totalLength,
      cumLengths,
      stops: stopPts,
      pathD,
    }
  }, [detail.route.geometry, detail.pickupPoints])

  // Find position at progress (0-1) along the path (pure function)
  // (Moved outside the component as `positionAt`.)

  // Bus position on the SVG (interpolated along path based on progress)
  // Note: positionAt is a pure module-level function — calling it directly (no memo)
  // is cheap and avoids a React Compiler manual-memoization mismatch.
  const busPos = positionAt(progress, points, totalLength, cumLengths)
  const busX = busPos[0]
  const busY = busPos[1]

  // Traveled path (start → bus position)
  const traveledPathD = useMemo(() => {
    if (points.length < 2 || progress <= 0) return ''
    if (progress >= 1) return pathD
    const targetDist = progress * totalLength
    let endIdx = 1
    for (let i = 1; i < cumLengths.length; i++) {
      if (cumLengths[i] >= targetDist) {
        endIdx = i
        break
      }
    }
    const segPts = points.slice(0, endIdx + 1)
    segPts[segPts.length - 1] = busPos
    return segPts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
      .join(' ')
  }, [points, progress, totalLength, cumLengths, busPos, pathD])

  const hasGeometry = points.length >= 2

  return { points, viewBox, stops, pathD, busX, busY, traveledPathD, hasGeometry }
}
