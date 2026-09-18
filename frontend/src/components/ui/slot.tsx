/**
 * Slot — a minimal replacement for `@radix-ui/react-slot`.
 *
 * Merges props onto a single child element. If `asChild` is true, the child
 * is cloned with the parent's props merged (child props win on conflict).
 * If `asChild` is false, renders a `<SlotComp>` (default: 'div') with the props.
 *
 * Used by shadcn/ui components like `Button`, `Badge`, `Breadcrumb` to support
 * the `asChild` prop pattern without depending on Radix.
 *
 * Example:
 *   <Button asChild>
 *     <Link to="/bookings">My Bookings</Link>
 *   </Button>
 *   // → <a href="/bookings" class="btn-styles">My Bookings</a>
 */

import {
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  RefObject,
  cloneElement,
  forwardRef,
  isValidElement,
} from 'react'

function mergeProps(
  parentProps: Record<string, unknown>,
  childProps: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...parentProps }

  for (const key in childProps) {
    const parentVal = parentProps[key]
    const childVal = childProps[key]

    if (key === 'className' && parentVal && childVal) {
      merged[key] = `${parentVal} ${childVal}`
    } else if (
      key.startsWith('on') &&
      typeof parentVal === 'function' &&
      typeof childVal === 'function'
    ) {
      merged[key] = (...args: unknown[]) => {
        ;(parentVal as (...a: unknown[]) => void)(...args)
        ;(childVal as (...a: unknown[]) => void)(...args)
      }
    } else {
      merged[key] = childVal ?? parentVal
    }
  }

  return merged
}

export interface SlotProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode
  asChild?: boolean
}

export const Slot = forwardRef<HTMLElement, SlotProps>(
  ({ asChild, children, ...props }, ref) => {
    if (!asChild || !isValidElement(children)) {
      return (
        <div ref={ref as Ref<HTMLDivElement>} {...props}>
          {children}
        </div>
      )
    }

    const child = children as ReactElement<Record<string, unknown>>
    const mergedProps = mergeProps(props, child.props)

    const childRef = child.props.ref as Ref<HTMLElement>
    const composedRef: Ref<HTMLElement> = (node) => {
      if (typeof ref === 'function') ref(node)
      else if (ref) (ref as RefObject<HTMLElement | null>).current = node
      if (typeof childRef === 'function') childRef(node)
      else if (childRef) (childRef as RefObject<HTMLElement | null>).current = node
    }

    return cloneElement(child, { ...mergedProps, ref: composedRef })
  },
)

Slot.displayName = 'Slot'
