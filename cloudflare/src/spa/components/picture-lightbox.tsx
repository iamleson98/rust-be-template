"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@spa/components/ui/dialog";
import { PictureSlider, type Slide } from "@spa/components/picture-slider";

/** The pictures at full size in a dialog of their own, opened on the one that was clicked. */
export function PictureLightbox({
  slides,
  index,
  onIndexChange,
  onClose,
  title,
}: {
  slides: Slide[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  title: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent mobile="fullscreen" className="max-w-5xl gap-3 p-3 pt-14 sm:p-4 sm:pt-14">
        <DialogTitle className="absolute top-4 left-4 max-w-[calc(100%-5rem)] truncate text-base">
          {title}
        </DialogTitle>
        <DialogDescription className="sr-only">{title}</DialogDescription>
        <PictureSlider
          slides={slides}
          index={index}
          onIndexChange={onIndexChange}
          globalKeys
          stageClassName="h-[62dvh] max-md:h-[calc(100dvh-11rem)]"
        />
      </DialogContent>
    </Dialog>
  );
}
