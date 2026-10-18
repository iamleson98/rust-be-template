/**
 * Slot — a minimal replacement for `@radix-ui/react-slot`.
 *
 * Renders its single child with the Slot's props merged in: classes are
 * joined, event handlers both run, refs are composed and otherwise the
 * child's props win. Components implement `asChild` by rendering a Slot in
 * place of their own element (`const Comp = asChild ? Slot : 'button'`).
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
  Children,
  cloneElement,
  forwardRef,
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
}

export const Slot = forwardRef<HTMLElement, SlotProps>(({ children, ...props }, ref) => {
  // Throws on anything but exactly one element: there is nothing to merge onto.
  const child = Children.only(children) as ReactElement<Record<string, unknown>>
  const mergedProps = mergeProps(props, child.props)

  const childRef = child.props.ref as Ref<HTMLElement>
  const composedRef: Ref<HTMLElement> = (node) => {
    if (typeof ref === 'function') ref(node)
    else if (ref) (ref as RefObject<HTMLElement | null>).current = node
    if (typeof childRef === 'function') childRef(node)
    else if (childRef) (childRef as RefObject<HTMLElement | null>).current = node
  }

  return cloneElement(child, { ...mergedProps, ref: composedRef })
})

Slot.displayName = 'Slot'
