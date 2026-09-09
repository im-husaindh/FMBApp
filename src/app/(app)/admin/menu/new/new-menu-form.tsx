'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MenuItemsEditor, type ItemRow } from '@/components/menu/menu-items-editor';

export function NewMenuForm({ action }: { action: (formData: FormData) => void }) {
  const [items, setItems] = useState<ItemRow[]>([
    { itemName: '', category: 'gravy', description: '', displayOrder: 0 },
  ]);

  return (
    <form action={action} className="mt-6 space-y-6">
      <input type="hidden" name="items" value={JSON.stringify(items)} />

      <div className="space-y-1">
        <Label htmlFor="serviceDate" className="text-lg">
          Date
        </Label>
        <Input id="serviceDate" name="serviceDate" type="date" required className="h-14 text-lg" />
      </div>

      <div className="space-y-1">
        <Label htmlFor="title" className="text-lg">
          Title (optional)
        </Label>
        <Input id="title" name="title" type="text" className="h-14 text-lg" />
      </div>

      <MenuItemsEditor items={items} onChange={setItems} />

      <Button type="submit" className="h-14 w-full text-xl font-semibold">
        Save Draft
      </Button>
    </form>
  );
}
