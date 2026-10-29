"use client";

/**
 * A picture slider: one large picture with previous / next buttons, a swipe
 * on touch screens, the arrow keys, and a strip of thumbnails to jump with.
 * Forward from the last picture wraps to the first.
 *
 * The slider is controlled (`index`) so a caller can start it on the picture
 * that was clicked. `PictureLightbox` puts it in a dialog; the trip dialog
 * shows it inline in its Pictures tab.
 */

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@spa/lib/i18n";
import { cn } from "@spa/lib/utils";

export interface Slide {
  id: string;
  /** The picture at a size worth looking at. */
  src: string;
  /** A small version for the thumbnail strip; `src` when omitted. */
  thumbSrc?: string;
  alt: string;
}

/** Horizontal travel, in px, that counts as a swipe rather than a tap. */
const SWIPE_PX = 50;

export function PictureSlider({
  slides,
  index,
  onIndexChange,
  stageClassName,
  globalKeys = false,
}: {
  slides: Slide[];
  index: number;
  onIndexChange: (index: number) => void;
  /** Sizes the stage (the large picture); it has no height of its own. */
  stageClassName?: string;
  /** Arrow keys work anywhere on the page, not only while the slider has focus. */
  globalKeys?: boolean;
}) {
  const t = useT();
  const count = slides.length;
  const current = Math.min(Math.max(index, 0), count - 1);
  const go = (by: number) => onIndexChange((current + by + count) % count);

  useEffect(() => {
    if (!globalKeys || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") onIndexChange((current - 1 + count) % count);
      else if (e.key === "ArrowRight") onIndexChange((current + 1) % count);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [globalKeys, count, current, onIndexChange]);

  // The neighbours load while this one is looked at, so a step shows no blank.
  useEffect(() => {
    if (count < 2) return;
    for (const by of [-1, 1]) new Image().src = slides[(current + by + count) % count].src;
  }, [slides, current, count]);

  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    thumbs.current[current]?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [current]);

  const swipeFrom = useRef<number | null>(null);

  if (count === 0) return null;
  const slide = slides[current];

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      tabIndex={0}
      onKeyDown={(e) => {
        if (globalKeys || count < 2) return;
        if (e.key === "ArrowLeft") go(-1);
        else if (e.key === "ArrowRight") go(1);
        else return;
        e.preventDefault();
      }}
      className="grid gap-2 outline-none"
    >
      <div
        className={cn(
          "relative touch-pan-y overflow-hidden rounded-xl bg-slate-950 select-none",
          stageClassName,
        )}
        onPointerDown={(e) => {
          swipeFrom.current = e.clientX;
        }}
        onPointerUp={(e) => {
          if (swipeFrom.current === null) return;
          const travel = e.clientX - swipeFrom.current;
          swipeFrom.current = null;
          if (Math.abs(travel) >= SWIPE_PX && count > 1) go(travel < 0 ? 1 : -1);
        }}
        onPointerCancel={() => {
          swipeFrom.current = null;
        }}
      >
        <img
          key={slide.id}
          src={slide.src}
          alt={slide.alt}
          draggable={false}
          decoding="async"
          className="h-full w-full object-contain"
        />
        <span
          aria-live="polite"
          className="absolute top-2 left-2 rounded-full bg-black/60 px-2.5 py-0.5 text-xs font-medium text-white tabular-nums"
        >
          {current + 1}/{count}
        </span>
        {count > 1 ? (
          <>
            <StepButton side="left" label={t("pictures.prev")} onClick={() => go(-1)}>
              <ChevronLeft className="h-5 w-5" />
            </StepButton>
            <StepButton side="right" label={t("pictures.next")} onClick={() => go(1)}>
              <ChevronRight className="h-5 w-5" />
            </StepButton>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <ul className="flex gap-1.5 overflow-x-auto pb-1">
          {slides.map((s, i) => (
            <li key={s.id} className="shrink-0">
              <button
                ref={(el) => {
                  thumbs.current[i] = el;
                }}
                type="button"
                aria-label={t("pictures.show", { index: i + 1 })}
                aria-current={i === current}
                onClick={() => onIndexChange(i)}
                className={cn(
                  "block h-12 w-16 overflow-hidden rounded-md ring-2 ring-transparent transition",
                  i === current ? "ring-primary" : "opacity-60 hover:opacity-100",
                )}
              >
                <img
                  src={s.thumbSrc ?? s.src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StepButton({
  side,
  label,
  onClick,
  children,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      // A swipe must not start on the button it would also press.
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-hidden",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      {children}
    </button>
  );
}
