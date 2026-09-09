export type MenuItemLike = {
  itemName: string;
  category: string;
  description?: string | null;
  displayOrder: number;
};

export type CategoryDiff = {
  category: string;
  changed: { old: MenuItemLike; new: MenuItemLike }[];
  added: MenuItemLike[];
  removed: MenuItemLike[];
};

function sortByOrder(items: MenuItemLike[]): MenuItemLike[] {
  return [...items].sort((a, b) => a.displayOrder - b.displayOrder);
}

function itemsEqual(a: MenuItemLike, b: MenuItemLike): boolean {
  return a.itemName === b.itemName && (a.description ?? '') === (b.description ?? '');
}

/**
 * Pairs old/new items within each category by position (display_order), not by name —
 * this matches the source spec's "Rice: Jeera Rice -> Veg Pulao" style diff, where a
 * single-item category's item being swapped reads as one change, not a remove+add.
 * # ponytail: positional pairing, not stable-matched by identity; a category with items
 * reordered between versions (not just edited) will show spurious changed pairs — fine
 * for the current single-admin-at-a-time editing flow, revisit if reordering becomes common.
 */
export function computeMenuDiff(
  oldItems: MenuItemLike[],
  newItems: MenuItemLike[]
): CategoryDiff[] {
  const categories = Array.from(
    new Set([...oldItems.map((i) => i.category), ...newItems.map((i) => i.category)])
  );

  return categories.map((category) => {
    const oldInCategory = sortByOrder(oldItems.filter((i) => i.category === category));
    const newInCategory = sortByOrder(newItems.filter((i) => i.category === category));
    const maxLen = Math.max(oldInCategory.length, newInCategory.length);

    const changed: { old: MenuItemLike; new: MenuItemLike }[] = [];
    const added: MenuItemLike[] = [];
    const removed: MenuItemLike[] = [];

    for (let i = 0; i < maxLen; i++) {
      const oldItem = oldInCategory[i];
      const newItem = newInCategory[i];
      if (oldItem && newItem) {
        if (!itemsEqual(oldItem, newItem)) changed.push({ old: oldItem, new: newItem });
      } else if (oldItem && !newItem) {
        removed.push(oldItem);
      } else if (!oldItem && newItem) {
        added.push(newItem);
      }
    }

    return { category, changed, added, removed };
  });
}
