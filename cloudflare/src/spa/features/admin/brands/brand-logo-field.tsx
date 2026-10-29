"use client";

/**
 * A brand's logo, picked in the brand dialog. Nothing is sent while picking:
 * Save uploads the new file first (`commit`) and puts its URL on the brand,
 * so Cancel throws the pick away. The server compresses it to WebP.
 */

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { uploadBrandLogo } from "@spa/api/uploads";
import { Button } from "@spa/components/ui/button";
import { useT } from "@spa/lib/i18n";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
/** The server's limit per file. */
const MAX_BYTES = 5 * 1024 * 1024;

export interface BrandLogo {
  /** What the dialog shows: the pick, else the saved logo unless removed. */
  preview: string | null;
  pick: (file: File) => void;
  remove: () => void;
  /**
   * Upload a new pick. Resolves to the URL to save on the brand, `null` when
   * the logo was removed, or `undefined` when it is unchanged.
   */
  commit: () => Promise<string | null | undefined>;
}

export function useBrandLogo(savedUrl: string | null | undefined, open: boolean): BrandLogo {
  const t = useT();
  // The picked file and the object URL that shows it.
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const [removed, setRemoved] = useState(false);

  // Each opening starts from the saved logo.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setPicked(null);
      setRemoved(false);
    }
  }

  // An object URL is released when the pick is replaced, dropped or the dialog goes away.
  useEffect(() => {
    const url = picked?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [picked]);

  return {
    preview: picked?.url ?? (removed ? null : (savedUrl ?? null)),
    pick: (file) => {
      if (!ACCEPTED.includes(file.type)) return void toast.error(t("brandLogo.badType"));
      if (file.size > MAX_BYTES) return void toast.error(t("brandLogo.tooLarge"));
      setPicked({ file, url: URL.createObjectURL(file) });
      setRemoved(false);
    },
    remove: () => {
      setPicked(null);
      setRemoved(true);
    },
    commit: async () => {
      if (picked) return uploadBrandLogo(picked.file);
      return removed ? null : undefined;
    },
  };
}

export function BrandLogoField({
  logo,
  name,
  disabled,
}: {
  logo: BrandLogo;
  name: string;
  disabled?: boolean;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-black/5">
        {logo.preview ? (
          <img
            src={logo.preview}
            alt={t("brandLogo.alt", { name })}
            className="h-full w-full object-contain"
          />
        ) : (
          <ImagePlus className="h-5 w-5 text-slate-400" aria-hidden />
        )}
      </div>
      <div className="grid gap-1">
        <span className="text-sm font-medium">{t("brandLogo.label")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) logo.pick(picked);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            <ImagePlus className="h-4 w-4" />{" "}
            {logo.preview ? t("brandLogo.change") : t("brandLogo.choose")}
          </Button>
          {logo.preview ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              onClick={logo.remove}
            >
              <Trash2 className="h-4 w-4" /> {t("brandLogo.remove")}
            </Button>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">{t("brandLogo.hint")}</p>
      </div>
    </div>
  );
}
