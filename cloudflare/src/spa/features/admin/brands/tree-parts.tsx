"use client";

/** Small pieces every level of the brands tree shares: the expander, the logo tile and the row actions. */

import { ChevronRight, ImageIcon } from "lucide-react";
import { useT } from "@spa/lib/i18n";
import { cn } from "@spa/lib/utils";

export function Expander({
  expanded,
  disabled,
  onToggle,
  label,
  small,
}: {
  expanded: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-expanded={expanded}
      aria-label={label}
      className={cn(
        "flex items-center justify-center rounded transition-colors",
        small ? "h-8 w-8" : "h-8 w-8",
        disabled
          ? "text-muted-foreground/30"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <ChevronRight
        className={cn(
          "transition-transform",
          small ? "h-3.5 w-3.5" : "h-4 w-4",
          expanded && "rotate-90",
        )}
        aria-hidden
      />
    </button>
  );
}

/** The brand's logo; a placeholder picture while none is set. */
export function BrandLogoTile({ logoUrl, name }: { logoUrl?: string | null; name: string }) {
  const t = useT();
  return (
    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-black/5 dark:bg-slate-800">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={t("brandLogo.alt", { name })}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain"
        />
      ) : (
        <ImageIcon className="h-4 w-4 text-slate-400" aria-hidden />
      )}
    </span>
  );
}

export function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-0.5">{children}</div>;
}

export function IconAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded transition-colors",
        danger
          ? "text-muted-foreground hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
