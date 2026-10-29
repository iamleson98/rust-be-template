"use client";

/**
 * A route's picture gallery, edited inside the route dialog.
 *
 * Nothing is sent while the admin picks, removes and reorders: the dialog's
 * Save writes the route first and then calls `commit` with the route's id, so
 * a new route can have pictures too and Cancel throws every change away. The
 * server re-encodes each upload to WebP (scaled down, EXIF dropped) before it
 * reaches R2, so the admin can pick straight from a phone.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deletePictureMutation,
  listPicturesOptions,
  patchPictureMutation,
  uploadPictureMutation,
} from "@spa/api";
import { Skeleton } from "@spa/components/ui/skeleton";
import { ChevronLeft, ChevronRight, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@spa/lib/i18n";
import { cn } from "@spa/lib/utils";

export const MAX_ROUTE_PICTURES = 10;
/** The server's limit per file (`MAX_PICTURE_BYTES`). */
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type PictureItem =
  | { kind: "saved"; id: string; src: string }
  | { kind: "new"; key: string; file: File; src: string };

const itemKey = (item: PictureItem) => (item.kind === "saved" ? item.id : item.key);

/** The same item moved one place; `items` itself when it is already at the end. */
function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = items.slice();
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export interface RoutePictures {
  items: PictureItem[];
  loading: boolean;
  /** Set while `commit` uploads: how many of how many are done. */
  progress: { done: number; total: number } | null;
  add: (files: File[]) => void;
  remove: (index: number) => void;
  shift: (index: number, by: -1 | 1) => void;
  /** Apply the edits to a route that exists; resolves to how many steps failed. */
  commit: (routeId: string) => Promise<number>;
}

export function useRoutePictures(routeId: string | undefined, open: boolean): RoutePictures {
  const t = useT();
  const queryClient = useQueryClient();
  const saved = useQuery({
    ...listPicturesOptions({ path: { id: routeId ?? "" } }),
    enabled: open && !!routeId,
    refetchOnMount: "always",
  });
  const uploadMutation = useMutation(uploadPictureMutation());
  const deleteMutation = useMutation(deletePictureMutation());
  const patchMutation = useMutation(patchPictureMutation());

  const [items, setItems] = useState<PictureItem[]>([]);
  const [progress, setProgress] = useState<RoutePictures["progress"]>(null);
  // What the server held when the dialog opened: the baseline `commit` diffs against.
  const [baseline, setBaseline] = useState<string[]>([]);
  const [seeded, setSeeded] = useState(false);

  const previews = useRef(new Set<string>());
  const revoke = useCallback((src: string) => {
    if (previews.current.delete(src)) URL.revokeObjectURL(src);
  }, []);
  const revokeAll = () => {
    previews.current.forEach((src) => URL.revokeObjectURL(src));
    previews.current.clear();
  };

  // Each opening starts from the server's list and drops the last one's edits.
  // Seeded once: a refetch (window focus, our own mutations) must not wipe the edits.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setSeeded(false);
      setItems([]);
      setProgress(null);
    }
  }
  if (open && !seeded && (!routeId || (saved.data && !saved.isFetching))) {
    const existing: PictureItem[] = (routeId ? (saved.data?.items ?? []) : []).map((p) => ({
      kind: "saved",
      id: p.id,
      src: p.thumbUrl,
    }));
    setSeeded(true);
    setBaseline(existing.map(itemKey));
    setItems(existing);
  }

  useEffect(() => {
    if (!open) revokeAll();
  }, [open]);
  useEffect(() => revokeAll, []);

  const add = (files: File[]) => {
    const next = items.slice();
    for (const file of files) {
      if (next.length >= MAX_ROUTE_PICTURES) {
        toast.error(t("routePictures.tooMany", { max: MAX_ROUTE_PICTURES }));
        break;
      }
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error(t("routePictures.badType", { name: file.name }));
        continue;
      }
      if (file.size > MAX_PICTURE_BYTES) {
        toast.error(t("routePictures.tooLarge", { name: file.name }));
        continue;
      }
      const src = URL.createObjectURL(file);
      previews.current.add(src);
      next.push({ kind: "new", key: crypto.randomUUID(), file, src });
    }
    setItems(next);
  };

  const remove = (index: number) => {
    const gone = items[index];
    if (gone) revoke(gone.src);
    setItems(items.filter((_, i) => i !== index));
  };

  const shift = (index: number, by: -1 | 1) => setItems(move(items, index, index + by));

  const commit = async (id: string): Promise<number> => {
    const kept = new Set(items.filter((i) => i.kind === "saved").map(itemKey));
    const doomed = baseline.filter((pid) => !kept.has(pid));
    const fresh = items.filter((i) => i.kind === "new");
    const order = items.map(itemKey);
    const untouched =
      doomed.length === 0 &&
      fresh.length === 0 &&
      order.length === baseline.length &&
      order.every((k, i) => k === baseline[i]);
    if (untouched) return 0;

    let failed = 0;
    for (const pictureId of doomed) {
      try {
        await deleteMutation.mutateAsync({ path: { id, pictureId } });
      } catch {
        failed++;
      }
    }

    // New files go up one at a time, in the order they sit in the gallery.
    const uploaded = new Map<string, string>();
    setProgress({ done: 0, total: fresh.length });
    for (const [n, item] of fresh.entries()) {
      try {
        const res = await uploadMutation.mutateAsync({
          path: { id },
          body: { file: item.file },
        } as unknown as Parameters<typeof uploadMutation.mutateAsync>[0]);
        uploaded.set(item.key, res.picture.id);
      } catch {
        failed++;
      }
      setProgress({ done: n + 1, total: fresh.length });
    }
    setProgress(null);

    // Uploads append, so put every picture where the admin placed it. The
    // server's own list is the truth for what is left (a failed delete stays).
    const wanted = [
      ...new Set(
        order.flatMap((k) => (uploaded.has(k) ? [uploaded.get(k)!] : kept.has(k) ? [k] : [])),
      ),
    ];
    try {
      const listing = await queryClient.fetchQuery({
        ...listPicturesOptions({ path: { id } }),
        staleTime: 0,
      });
      const server = listing.items.map((p) => p.id);
      const target = [...wanted, ...server.filter((pid) => !wanted.includes(pid))];
      // `sortOrder` is a list-insert: mirror that to touch only what has to move.
      for (const [position, pictureId] of target.entries()) {
        if (server[position] === pictureId) continue;
        await patchMutation.mutateAsync({
          path: { id, pictureId },
          body: { sortOrder: position },
        });
        server.splice(server.indexOf(pictureId), 1);
        server.splice(position, 0, pictureId);
      }
    } catch {
      failed++;
    }
    return failed;
  };

  return {
    items,
    loading: open && !!routeId && !seeded,
    progress,
    add,
    remove,
    shift,
    commit,
  };
}

export function RoutePicturesField({
  pictures,
  disabled,
}: {
  pictures: RoutePictures;
  disabled?: boolean;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const { items } = pictures;
  const full = items.length >= MAX_ROUTE_PICTURES;

  return (
    <section className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{t("routePictures.title")}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {items.length}/{MAX_ROUTE_PICTURES}
        </span>
      </div>

      <input
        ref={input}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(e) => {
          pictures.add(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {pictures.loading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-lg" />
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {items.map((item, i) => (
            <li
              key={itemKey(item)}
              className="relative aspect-[4/3] overflow-hidden rounded-lg ring-1 ring-black/10"
            >
              <img
                src={item.src}
                alt={t("routePictures.alt", { index: i + 1 })}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
              {i === 0 ? (
                <span className="absolute top-1 left-1 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {t("routePictures.cover")}
                </span>
              ) : null}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-0.5 py-0.5 text-white">
                <div className="flex">
                  <TileButton
                    label={t("routePictures.earlier")}
                    disabled={disabled || i === 0}
                    onClick={() => pictures.shift(i, -1)}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </TileButton>
                  <TileButton
                    label={t("routePictures.later")}
                    disabled={disabled || i === items.length - 1}
                    onClick={() => pictures.shift(i, 1)}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </TileButton>
                </div>
                <TileButton
                  label={t("routePictures.remove")}
                  disabled={disabled}
                  className="hover:bg-rose-600"
                  onClick={() => pictures.remove(i)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </TileButton>
              </div>
            </li>
          ))}
          {full ? null : (
            <li>
              <button
                type="button"
                disabled={disabled}
                onClick={() => input.current?.click()}
                className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-muted-foreground transition-colors hover:border-blue-400 hover:bg-blue-50/40 disabled:pointer-events-none disabled:opacity-50"
              >
                <ImagePlus className="h-4 w-4" />
                <span className="text-[11px] font-medium">{t("routePictures.add")}</span>
              </button>
            </li>
          )}
        </ul>
      )}

      <p className="text-[11px] text-muted-foreground">
        {t("routePictures.hint", { max: MAX_ROUTE_PICTURES })}
      </p>
    </section>
  );
}

function TileButton({
  label,
  disabled,
  className,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-white/25 disabled:pointer-events-none disabled:opacity-30",
        className,
      )}
    >
      {children}
    </button>
  );
}
