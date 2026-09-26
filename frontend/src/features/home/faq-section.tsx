'use client'

import { memo, useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Card } from '@/components/ui/card'
import { Phone, Mail, MessageSquare, HelpCircle, Headphones } from 'lucide-react'
import { useT } from '@/lib/i18n'

type Faq = {
  q: string
  a: string
}

const FAQS: Faq[] = [
  { q: 'home.faqQ1', a: 'home.faqA1' },
  { q: 'home.faqQ2', a: 'home.faqA2' },
  { q: 'home.faqQ3', a: 'home.faqA3' },
  { q: 'home.faqQ4', a: 'home.faqA4' },
  { q: 'home.faqQ5', a: 'home.faqA5' },
  { q: 'home.faqQ6', a: 'home.faqA6' },
  { q: 'home.faqQ7', a: 'home.faqA7' },
  { q: 'home.faqQ8', a: 'home.faqA8' },
]

export const FaqSection = memo(function FaqSection() {
  const t = useT()
  // Allow multiple items open at the same time for easier reading.
  const [openItems, setOpenItems] = useState<string[]>([])

  return (
    <section className="bg-slate-50" aria-labelledby="faq-heading">
      <div className="container mx-auto max-w-6xl py-16 px-4">
        {/* Heading */}
        <div className="text-center mb-10 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1 text-rose-700 text-xs font-semibold mb-4">
            <HelpCircle className="size-3.5" />
            {t('home.faqBadge')}
          </div>
          <h2
            id="faq-heading"
            className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900"
          >
            {t('home.faqTitle')}
          </h2>
          <p className="mt-3 text-slate-600 text-base md:text-lg">
            {t('home.faqSubtitle')}
          </p>
        </div>

        {/* Two-column accordion grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left column */}
          <Card className="p-4 md:p-6 border-slate-200 bg-white">
            <Accordion
              type="multiple"
              value={openItems}
              onValueChange={setOpenItems}
              className="w-full"
            >
              {FAQS.slice(0, 4).map((faq, i) => (
                <AccordionItem key={faq.q} value={`item-${i + 1}`}>
                  <AccordionTrigger className="text-sm md:text-base font-semibold text-slate-900 hover:no-underline">
                    <span className="flex items-start gap-2">
                      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-[10px] font-bold text-rose-700">
                        {i + 1}
                      </span>
                      <span className="text-left">{t(faq.q)}</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-slate-600 leading-relaxed pl-7">
                    {t(faq.a)}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Card>

          {/* Right column */}
          <Card className="p-4 md:p-6 border-slate-200 bg-white">
            <Accordion
              type="multiple"
              value={openItems}
              onValueChange={setOpenItems}
              className="w-full"
            >
              {FAQS.slice(4).map((faq, i) => (
                <AccordionItem key={faq.q} value={`item-${i + 5}`}>
                  <AccordionTrigger className="text-sm md:text-base font-semibold text-slate-900 hover:no-underline">
                    <span className="flex items-start gap-2">
                      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-[10px] font-bold text-rose-700">
                        {i + 5}
                      </span>
                      <span className="text-left">{t(faq.q)}</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-slate-600 leading-relaxed pl-7">
                    {t(faq.a)}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Card>
        </div>

        {/* Contact CTA */}
        <div className="mt-10 rounded-2xl bg-linear-to-br from-slate-900 to-rose-900 p-6 md:p-8 text-white">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-full bg-white/10 p-3">
                <Headphones className="size-6" />
              </div>
              <div>
                <h3 className="text-lg md:text-xl font-bold">{t('home.faqContactTitle')}</h3>
                <p className="text-sm text-white/70 mt-1">
                  {t('home.faqContactDesc')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full md:w-auto">
              <a
                href="tel:19006067"
                className="group flex items-center gap-3 rounded-xl bg-white/10 hover:bg-white/15 transition-colors px-4 py-3 ring-1 ring-white/10"
              >
                <Phone className="size-5 text-rose-300" />
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/60">
                    {t('home.faqHotline')}
                  </div>
                  <div className="text-sm font-semibold">1900 6067</div>
                </div>
              </a>
              <a
                href="mailto:cskh@datxevui.vn"
                className="group flex items-center gap-3 rounded-xl bg-white/10 hover:bg-white/15 transition-colors px-4 py-3 ring-1 ring-white/10"
              >
                <Mail className="size-5 text-rose-300" />
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/60">
                    {t('home.faqEmail')}
                  </div>
                  <div className="text-sm font-semibold">cskh@datxevui.vn</div>
                </div>
              </a>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/60 border-t border-white/10 pt-4">
            <span className="inline-flex items-center gap-1.5">
              <MessageSquare className="size-3.5" />
              {t('home.faqChatDirect')}
            </span>
            <span>•</span>
            <span>{t('home.faqResponseTime')}</span>
            <span>•</span>
            <span>{t('home.faqLanguages')}</span>
          </div>
        </div>
      </div>
    </section>
  )
})
