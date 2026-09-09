'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MenuItemsEditor, type ItemRow } from '@/components/menu/menu-items-editor';
import { updateMenuVersionAction } from './actions';

export function EditMenuForm({
  menuId,
  versionId,
  title,
  items: initialItems,
}: {
  menuId: string;
  versionId: string;
  title: string;
  items: { item_name: string; category: string; description: string | null; display_order: number }[];
}) {
  const [items, setItems] = useState<ItemRow[]>(
    [...initialItems]
      .sort((a, b) => a.display_order - b.display_order)
      .map((i) => ({
        itemName: i.item_name,
        category: i.category,
        description: i.description ?? '',
        displayOrder: i.display_order,
      }))
  );

  return (
    <form action={updateMenuVersionAction} className="mt-6 space-y-6">
      <input type="hidden" name="menuId" value={menuId} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />

      <div className="space-y-1">
        <Label htmlFor="title" className="text-lg">
          Title (optional)
        </Label>
        <Input id="title" name="title" type="text" defaultValue={title} className="h-14 text-lg" />
      </div>

      <MenuItemsEditor items={items} onChange={setItems} />

      <Button type="submit" className="h-14 w-full text-xl font-semibold">
        Save Changes
      </Button>
    </form>
  );
}
