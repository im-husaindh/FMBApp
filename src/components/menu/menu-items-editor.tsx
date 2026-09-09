'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MENU_ITEM_CATEGORIES } from '@/lib/validation/menu';

export type ItemRow = {
  itemName: string;
  category: string;
  description: string;
  displayOrder: number;
};

export function MenuItemsEditor({
  items,
  onChange,
}: {
  items: ItemRow[];
  onChange: (items: ItemRow[]) => void;
}) {
  function addItem() {
    onChange([...items, { itemName: '', category: 'gravy', description: '', displayOrder: items.length }]);
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function updateItem(index: number, field: keyof ItemRow, value: string) {
    onChange(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold">Items</p>
      {items.map((item, index) => (
        <div key={index} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 p-3">
          <div className="min-w-[160px] flex-1">
            <Label htmlFor={`item-name-${index}`} className="text-sm">Item name</Label>
            <Input
              id={`item-name-${index}`}
              value={item.itemName}
              onChange={(e) => updateItem(index, 'itemName', e.target.value)}
              className="h-12"
            />
          </div>
          <div>
            <Label htmlFor={`item-category-${index}`} className="text-sm">Category</Label>
            <select
              id={`item-category-${index}`}
              value={item.category}
              onChange={(e) => updateItem(index, 'category', e.target.value)}
              className="h-12 rounded-lg border border-gray-300 px-3"
            >
              {MENU_ITEM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            onClick={() => removeItem(index)}
            className="h-12 bg-gray-200 text-gray-800 hover:bg-gray-300"
          >
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" onClick={addItem} className="h-12 bg-gray-100 text-gray-800 hover:bg-gray-200">
        + Add Item
      </Button>
    </div>
  );
}
