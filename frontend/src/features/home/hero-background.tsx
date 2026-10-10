/** The hero photo (a coach on a Vietnamese mountain road), darkened toward the headline side for legibility. */
export function HeroBackground() {
  return (
    <div className="absolute inset-0 -z-10 bg-slate-800">
      <picture>
        <source srcSet="/hero-vietnam-bus.avif" type="image/avif" media="(min-width: 641px)" />
        <source
          srcSet="/hero-vietnam-bus-mobile.webp 640w, /hero-vietnam-bus.webp 1344w"
          sizes="100vw"
          type="image/webp"
        />
        <source
          srcSet="/hero-vietnam-bus-mobile.jpg 640w, /hero-vietnam-bus.jpg 1344w"
          sizes="100vw"
          type="image/jpeg"
        />
        <img
          src="/hero-vietnam-bus.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          // Above the fold: fetch first, decode off the main thread.
          fetchPriority="high"
          loading="eager"
          decoding="async"
          width={1344}
          height={768}
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      </picture>
      <div className="absolute inset-0 bg-linear-to-r from-slate-950/80 via-slate-950/45 to-slate-950/10" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-slate-950/55 to-transparent" />
    </div>
  )
}
