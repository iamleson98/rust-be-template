"use client";

import { useState } from "react";
import { PictureSlider, type Slide } from "@spa/components/picture-slider";

/** The route's pictures, one at a time; the same gallery for every trip on the route. */
export function TripPictures({ slides }: { slides: Slide[] }) {
  const [index, setIndex] = useState(0);
  return (
    <PictureSlider
      slides={slides}
      index={index}
      onIndexChange={setIndex}
      stageClassName="aspect-[4/3] max-h-[60dvh] w-full"
    />
  );
}
