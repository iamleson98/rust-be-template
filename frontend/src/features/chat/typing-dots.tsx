const DELAYS_MS = [0, 150, 300]

/** Three bouncing dots in a bubble: the other side is typing. */
export function TypingDots() {
  return (
    <div className="rounded-2xl rounded-bl-sm border bg-white px-3 py-2.5">
      <div className="flex items-center gap-1">
        {DELAYS_MS.map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  )
}
