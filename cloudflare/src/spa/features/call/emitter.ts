/** Tiny typed event emitter; a throwing handler never breaks the others. */
export class Emitter<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<(data: never) => void>>()

  /** Subscribe; returns the unsubscribe function. */
  on<K extends keyof Events>(event: K, handler: (data: Events[K]) => void): () => void {
    const set = this.handlers.get(event) ?? new Set()
    set.add(handler as (data: never) => void)
    this.handlers.set(event, set)
    return () => {
      set.delete(handler as (data: never) => void)
    }
  }

  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        ;(handler as (data: Events[K]) => void)(data)
      } catch {
        // one bad subscriber must not starve the rest
      }
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}
