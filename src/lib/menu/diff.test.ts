import { describe, it, expect } from 'vitest';
import { computeMenuDiff } from './diff';

describe('computeMenuDiff', () => {
  it('shows a same-position item change as changed, not added+removed', () => {
    const oldItems = [{ itemName: 'Jeera Rice', category: 'rice', displayOrder: 0 }];
    const newItems = [{ itemName: 'Veg Pulao', category: 'rice', displayOrder: 0 }];
    const diff = computeMenuDiff(oldItems, newItems);
    expect(diff).toEqual([
      { category: 'rice', changed: [{ old: oldItems[0], new: newItems[0] }], added: [], removed: [] },
    ]);
  });

  it('shows a brand-new category as added', () => {
    const diff = computeMenuDiff([], [{ itemName: 'Gulab Jamun', category: 'sweet', displayOrder: 0 }]);
    expect(diff[0]).toEqual({
      category: 'sweet',
      changed: [],
      added: [{ itemName: 'Gulab Jamun', category: 'sweet', displayOrder: 0 }],
      removed: [],
    });
  });

  it('shows a removed category item as removed', () => {
    const diff = computeMenuDiff([{ itemName: 'Salad', category: 'salad', displayOrder: 0 }], []);
    expect(diff[0].removed).toEqual([{ itemName: 'Salad', category: 'salad', displayOrder: 0 }]);
  });

  it('omits unchanged items from changed/added/removed', () => {
    const item = { itemName: 'Roti', category: 'roti', displayOrder: 0 };
    const diff = computeMenuDiff([item], [item]);
    expect(diff).toEqual([{ category: 'roti', changed: [], added: [], removed: [] }]);
  });
});
