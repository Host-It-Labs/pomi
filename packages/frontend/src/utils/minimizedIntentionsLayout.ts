export const COMPACT_INTENTION_BUTTON_SIZE_PX = 28;
export const COMPACT_INTENTION_GAP_PX = 8;
export const COMPACT_PAGINATION_BUTTON_SIZE_PX = 20;
export const COMPACT_PAGINATION_GAP_PX = 4;

const COMPACT_GRID_COLUMN_CLASSES = {
  1: 'grid-cols-[1.75rem]',
  2: 'grid-cols-[repeat(2,1.75rem)]',
  3: 'grid-cols-[repeat(3,1.75rem)]',
  4: 'grid-cols-[repeat(4,1.75rem)]',
  5: 'grid-cols-[repeat(5,1.75rem)]',
} as const;

export function getCompactGridColumnClass(slotCount: number) {
  const normalizedSlotCount = Math.min(5, Math.max(1, Math.floor(slotCount)));
  return COMPACT_GRID_COLUMN_CLASSES[
    normalizedSlotCount as keyof typeof COMPACT_GRID_COLUMN_CLASSES
  ];
}

export function getCompactPickerMinWidth(
  slotCount: number,
  hasPaginationControls: boolean
) {
  const normalizedSlotCount = Math.min(5, Math.max(1, Math.floor(slotCount)));
  const gridWidth =
    normalizedSlotCount * COMPACT_INTENTION_BUTTON_SIZE_PX +
    (normalizedSlotCount - 1) * COMPACT_INTENTION_GAP_PX;

  if (!hasPaginationControls) {
    return gridWidth;
  }

  return (
    gridWidth +
    2 * COMPACT_PAGINATION_BUTTON_SIZE_PX +
    2 * COMPACT_PAGINATION_GAP_PX
  );
}

export type MinimizedPickerInsets = {
  left: number;
  right: number;
};

export function areMinimizedPickerInsetsEqual(
  first: MinimizedPickerInsets,
  second: MinimizedPickerInsets
) {
  return first.left === second.left && first.right === second.right;
}
