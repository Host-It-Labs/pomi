export function getWheelPageDirection(
  deltaX: number,
  deltaY: number,
  threshold: number
): -1 | 1 | null {
  const dominantDelta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  if (Math.abs(dominantDelta) < threshold) return null;
  return dominantDelta > 0 ? 1 : -1;
}
