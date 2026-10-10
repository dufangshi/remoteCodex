export interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type TourPlacement = 'bottom' | 'top' | 'right' | 'left' | 'dock-top' | 'dock-bottom';

const MARGIN = 8;
const GAP = 12;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Places the card next to the target without covering it. When no side has
 * room (large targets on a phone) the card docks to the screen edge farther
 * from the target's centre, or to the bottom for a tall target. Without a target it sits in a corner, clear of
 * the page header (`top`) or of lists and links (`bottom`).
 */
export function placeCard(
  target: TourRect | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  dock: 'top' | 'bottom' = 'top',
): { top: number; left: number; placement: TourPlacement } {
  const maxLeft = Math.max(MARGIN, viewport.width - card.width - MARGIN);
  const maxTop = Math.max(MARGIN, viewport.height - card.height - MARGIN);
  if (!target) {
    const edge = viewport.width < 640 ? MARGIN : 16;
    const left = clamp(viewport.width - card.width - edge, MARGIN, maxLeft);
    return dock === 'top'
      ? { top: clamp(56, MARGIN, maxTop), left, placement: 'dock-top' }
      : { top: clamp(viewport.height - card.height - edge, MARGIN, maxTop), left, placement: 'dock-bottom' };
  }
  const bottom = target.top + target.height;
  const right = target.left + target.width;
  const centredLeft = clamp(target.left + target.width / 2 - card.width / 2, MARGIN, maxLeft);
  const centredTop = clamp(target.top + target.height / 2 - card.height / 2, MARGIN, maxTop);
  const fitsBelow = bottom + GAP + card.height <= viewport.height - MARGIN;
  const fitsAbove = target.top - GAP - card.height >= MARGIN;
  const fitsRight = right + GAP + card.width <= viewport.width - MARGIN;
  const fitsLeft = target.left - GAP - card.width >= MARGIN;
  const lowerHalf = target.top + target.height / 2 > viewport.height / 2;
  const vertical: TourPlacement[] = lowerHalf ? ['top', 'bottom'] : ['bottom', 'top'];
  // A tall target (sidebar, file tree) reads better with the card beside it.
  const order: TourPlacement[] = target.height > viewport.height / 2 ? ['right', 'left', ...vertical] : [...vertical, 'right', 'left'];
  for (const placement of order) {
    if (placement === 'bottom' && fitsBelow) return { top: bottom + GAP, left: centredLeft, placement };
    if (placement === 'top' && fitsAbove) return { top: target.top - GAP - card.height, left: centredLeft, placement };
    if (placement === 'right' && fitsRight) return { top: centredTop, left: right + GAP, placement };
    if (placement === 'left' && fitsLeft) return { top: centredTop, left: target.left - GAP - card.width, placement };
  }
  // Lists and drawers start at the top, so a tall target keeps its head visible.
  const tall = target.height > viewport.height * 0.6;
  return lowerHalf && !tall
    ? { top: MARGIN, left: clamp((viewport.width - card.width) / 2, MARGIN, maxLeft), placement: 'dock-top' }
    : { top: maxTop, left: clamp((viewport.width - card.width) / 2, MARGIN, maxLeft), placement: 'dock-bottom' };
}

export function unionRect(a: TourRect, b: TourRect | null): TourRect {
  if (!b) return a;
  const top = Math.min(a.top, b.top);
  const left = Math.min(a.left, b.left);
  return {
    top,
    left,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
}

export function sameRect(a: TourRect | null, b: TourRect | null) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}
