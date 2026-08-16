/**
 * useIsMobile — returns true when the viewport is below the `MOBILE_SCREEN_WIDTH`
 * breakpoint. Re-evaluates on resize via a `matchMedia` listener.
 *
 * Used by `sidebar.tsx` to switch between desktop and mobile (Sheet) layouts.
 */
import { useEffect, useState } from "react"

const MOBILE_SCREEN_WIDTH = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.innerWidth < MOBILE_SCREEN_WIDTH
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    const mql = window.matchMedia(`(max-width: ${MOBILE_SCREEN_WIDTH - 1}px)`)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
