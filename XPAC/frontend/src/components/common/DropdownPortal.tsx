import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A dropdown that cannot be clipped by anything above it.
 *
 * Every list screen in SYNC puts its toolbar in a `overflow-x-auto` row so the buttons
 * can scroll sideways on a narrow window, and the content column around it is
 * `overflow-hidden` so the page body never scrolls. Both are correct, and both create
 * a clipping box: an `absolute` menu inside them is cut off at the toolbar's bottom
 * edge, which is why the Column Visibility list came out as a two-pixel sliver.
 *
 * The pages worked around it with `position: fixed` plus a hand-tuned
 * `-translate-x-[calc(100%-3.5rem)]`, which escapes the clip but pins the menu to a
 * guessed offset — so it drifted away from its button on a different window width and
 * stayed behind when anything scrolled.
 *
 * This renders into `document.body` instead. Nothing between the button and the root
 * can clip it or trap it in a stacking context, and the position is measured from the
 * trigger on every open, scroll and resize rather than guessed once.
 *
 * It is presentation only: open state stays with the caller, so a menu keeps whatever
 * open/close behaviour it already had.
 */

interface DropdownPortalProps {
  /** The button the menu hangs off. Used for both placement and outside-click. */
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Which edge of the menu lines up with the trigger. */
  align?: 'left' | 'right';
  /** Fixed width in px. Omit to let the content size itself. */
  width?: number;
  /** Extra classes for the panel — the caller owns its surface and border. */
  className?: string;
  children: React.ReactNode;
}

/** Gap between the trigger and the panel, matching the `mt-1` the menus used inline. */
const OFFSET = 4;

/** Keeps a panel off the exact edge of the viewport. */
const MARGIN = 8;

const DropdownPortal: React.FC<DropdownPortalProps> = ({
  anchorRef,
  open,
  onClose,
  align = 'right',
  width,
  className = '',
  children,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const panel = panelRef.current;
    const panelWidth = width ?? panel?.offsetWidth ?? 0;
    const panelHeight = panel?.offsetHeight ?? 0;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const below = viewportHeight - rect.bottom - OFFSET - MARGIN;
    const above = rect.top - OFFSET - MARGIN;

    // Flip above the trigger only when there is genuinely more room there — a menu
    // near the bottom of a short window otherwise opens downward into nothing.
    const flip = below < Math.min(panelHeight, 220) && above > below;

    const top = flip
      ? Math.max(MARGIN, rect.top - OFFSET - panelHeight)
      : rect.bottom + OFFSET;

    let left = align === 'right' ? rect.right - panelWidth : rect.left;
    // Clamp so a right-aligned menu on a narrow window cannot run off either edge.
    left = Math.min(left, viewportWidth - panelWidth - MARGIN);
    left = Math.max(MARGIN, left);

    setPosition({
      top,
      left,
      maxHeight: Math.max(160, (flip ? above : below)),
    });
  }, [anchorRef, align, width]);

  // Before paint, so the panel never renders at a stale position for one frame.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    // `true` captures scrolls on every ancestor, not just the window — the table and
    // the toolbar are both scroll containers, and a menu that stayed put while the
    // thing it points at moved is worse than one that is clipped.
    const onScroll = () => place();
    const onResize = () => place();

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      // Clicks on the trigger are its own toggle; closing here too would re-open and
      // immediately close, so the menu would never appear.
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, place, anchorRef, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      // Marks the panel for pages that keep their own outside-click handler: a click
      // landing in here is inside the menu, even though the DOM says it is in <body>.
      data-dropdown-portal=""
      // z-[100] clears the sticky table headers (z-10), the sidebar resize handle
      // (z-10) and the tools' own banners, while staying under the confirmation
      // modals at z-[900] — a dropdown must never float over a dialog.
      className={`fixed z-[100] ${className}`}
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width: width ? `${width}px` : undefined,
        maxHeight: position?.maxHeight,
        // Hidden until measured, so it cannot flash at the top-left corner.
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body
  );
};

export default DropdownPortal;
