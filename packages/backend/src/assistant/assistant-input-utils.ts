export function normalizeOptionalString(value: string | null | undefined) {
  return value?.trim() || null;
}
