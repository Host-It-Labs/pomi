export function stableFavoriteFirst<T extends { isFavorite: boolean }>(
  items: T[]
) {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        Number(b.item.isFavorite) - Number(a.item.isFavorite) ||
        a.index - b.index
    )
    .map(({ item }) => item);
}
