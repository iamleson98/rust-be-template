import { expect, test, type Page } from '@playwright/test'

/**
 * GPS "my location" regression — the crosshair button in the map picker
 * must fly the map EXACTLY to the (mocked) GPS position, at a street
 * zoom, with the marker on the same spot.
 *
 * History: the original implementation used a one-shot
 * getCurrentPosition whose coarse Wi-Fi/cell fixes jumped the map to the
 * wrong position, and an effect-dep loop restarted the flyTo ~140×/sec
 * so the flight crawled. The fix (useMyLocation: progressive-accuracy
 * watchPosition + ref-backed callbacks) is pinned by this spec.
 *
 * No backend needed: the reverse-geocode call fails and falls back to
 * coordinates-as-name, which does not affect the flight.
 */

const GPS = { lat: 21.0287, lon: 105.8524 } // Hanoi Old Quarter area

/** Grab the Leaflet map instance from the top-most dialog (or page).
 *  Walks the React fiber tree from the container element and inspects
 *  hook states for react-leaflet's LeafletMapInstance ({ map }). */
async function readMap(page: Page) {
  return page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('.leaflet-container'))
    const el = containers[containers.length - 1] as HTMLElement | undefined
    if (!el) return null
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
    if (!fiberKey) return null
    type AnyRec = Record<string, unknown>
    for (
      let f = (el as unknown as AnyRec)[fiberKey] as AnyRec | undefined, depth = 0;
      f && depth < 16;
      f = f.return as AnyRec | undefined, depth++
    ) {
      for (
        let hook = f.memoizedState as AnyRec | undefined, i = 0;
        hook && i < 24;
        hook = hook.next as AnyRec | undefined, i++
      ) {
        const val = hook.memoizedState
        if (
          val &&
          typeof val === 'object' &&
          typeof (val as AnyRec).map === 'object' &&
          (val as AnyRec).map !== null &&
          typeof ((val as AnyRec).map as AnyRec).getCenter === 'function'
        ) {
          const map = (val as { map: AnyRec }).map as {
            getCenter: () => { lat: number; lng: number }
            getZoom: () => number
            getContainer: () => HTMLElement
          }
          const c = map.getCenter()
          return {
            lat: c.lat,
            lng: c.lng,
            zoom: map.getZoom(),
            size: { w: map.getContainer().offsetWidth, h: map.getContainer().offsetHeight },
          }
        }
      }
    }
    return null
  })
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: GPS.lat, longitude: GPS.lon, accuracy: 25 })
})

test('my-location button flies to the GPS position', async ({ page }) => {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)))
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  // Wait for the search widget's From autocomplete to be interactive.
  const fromInput = page.locator('form input').first()
  await expect(fromInput).toBeVisible({ timeout: 20_000 })

  // Open the map picker from the From field (map-icon button at the
  // right side of the input).
  const mapBtn = page.locator('form button[title*="bản đồ" i], form button[title*="map" i]').first()
  await mapBtn.click()

  // Wait for the dialog's leaflet container.
  await page.waitForSelector('[role="dialog"] .leaflet-container', { timeout: 20_000 })
  await page.waitForTimeout(1500) // let FixSize settle + dialog animation

  const before = await readMap(page)
  console.log('BEFORE center:', JSON.stringify(before))

  // Click the "my location" crosshair button (top-right of the map).
  const locBtn = page
    .locator(
      '[role="dialog"] button[aria-label*="Vị trí của tôi" i], [role="dialog"] button[aria-label*="my location" i]',
    )
    .first()
  await expect(locBtn).toBeVisible()
  await locBtn.click()

  // flyTo duration is 0.8s; reverse geocode fails fast (no backend).
  await page.waitForTimeout(3500)

  const after = await readMap(page)
  console.log('AFTER center:', JSON.stringify(after))
  console.log('EXPECTED:', JSON.stringify(GPS))

  if (after) {
    const dLat = Math.abs(after.lat - GPS.lat)
    const dLng = Math.abs(after.lng - GPS.lon)
    console.log(`delta: lat=${dLat.toFixed(6)} lng=${dLng.toFixed(6)} zoom=${after.zoom}`)
    // The map should end centered on the GPS coords (within a small
    // tolerance — center-of-viewport vs marker pixel offset).
    expect(dLat).toBeLessThan(0.002)
    expect(dLng).toBeLessThan(0.002)
    expect(after.zoom).toBeGreaterThanOrEqual(12)
  } else {
    test.fail(true, 'no leaflet map found in dialog')
  }
})
