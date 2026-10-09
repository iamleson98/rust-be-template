/**
 * Height of each pane while the two cards stack (below `xl`). It must be a fixed
 * height, not `max-h`: the scroll area's viewport is `size-full`, so with only a
 * max height it would grow with its content and never scroll. From `xl` both
 * cards share one definite height (`xl:h-160`) and the panes fill it.
 */
export const PANES_HEIGHT = 'h-[32rem]'
