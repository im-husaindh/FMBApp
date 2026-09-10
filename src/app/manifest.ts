import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FMBRequestThali',
    short_name: 'FMBRequestThali',
    description: 'Request and manage daily thali meals for FMB Community',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2563eb',
    icons: [
      { src: '/icon', sizes: '192x192', type: 'image/png' },
      { src: '/icon512', sizes: '512x512', type: 'image/png' },
    ],
  };
}
