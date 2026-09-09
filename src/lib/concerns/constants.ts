export const CONCERN_CATEGORIES: { value: string; label: string }[] = [
  { value: 'taste', label: 'Taste' },
  { value: 'quality', label: 'Quality' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'missing_item', label: 'Missing Item' },
  { value: 'menu', label: 'Menu' },
  { value: 'other', label: 'Other' },
];

export const CONCERN_STATUSES: { value: string; label: string; icon: string; classes: string }[] = [
  { value: 'open', label: 'Open', icon: '!', classes: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  { value: 'reviewing', label: 'Reviewing', icon: '⋯', classes: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'resolved', label: 'Resolved', icon: '✓', classes: 'bg-green-50 text-green-700 border-green-200' },
  { value: 'closed', label: 'Closed', icon: '✕', classes: 'bg-gray-50 text-gray-700 border-gray-200' },
];
