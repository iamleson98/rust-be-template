import type { Lang } from '@/lib/i18n'
import { useT } from '@/lib/i18n'
import { usePrefs } from '@/stores/prefs'

/** A paragraph, or a bulleted list. */
export type LegalBlock = string | { list: string[] }

export type LegalDoc = {
  title: string
  /** Date this version took effect, as shown to readers. */
  updated: string
  intro: string[]
  sections: { id: string; heading: string; body: LegalBlock[] }[]
}

/**
 * A legal document (privacy policy, terms) in the reader's language: a
 * contents list, then numbered sections a provider console can link to by
 * anchor (`/privacy#data-deletion`). Prerendered to HTML at build time so
 * crawlers and reviewers read it without running scripts.
 */
export function LegalPage({ doc }: { doc: Record<Lang, LegalDoc> }) {
  const t = useT()
  const lang = usePrefs((s) => s.lang)
  const d = doc[lang] ?? doc.vi

  return (
    <article className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16 md:py-10">
      <header className="space-y-2 border-b pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-balance md:text-3xl">{d.title}</h1>
        <p className="text-sm text-muted-foreground">{t('legal.updated', { date: d.updated })}</p>
      </header>

      <div className="space-y-3 pt-5 text-[15px] leading-relaxed">
        {d.intro.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>

      <nav aria-label={t('legal.contents')} className="mt-6 rounded-xl border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">{t('legal.contents')}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-primary">
          {d.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="hover:underline">
                {s.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {d.sections.map((s, i) => (
        <section key={s.id} id={s.id} className="scroll-mt-20 pt-8">
          <h2 className="text-lg font-semibold">
            {i + 1}. {s.heading}
          </h2>
          <div className="mt-3 space-y-3 text-[15px] leading-relaxed">
            {s.body.map((block, j) =>
              typeof block === 'string' ? (
                <p key={j}>{block}</p>
              ) : (
                <ul key={j} className="list-disc space-y-1.5 pl-5">
                  {block.list.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ),
            )}
          </div>
        </section>
      ))}
    </article>
  )
}
