import { ImageResponse } from 'next/og';

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#2563eb',
          color: '#ffffff',
          fontSize: 232,
          fontWeight: 700,
          fontFamily: 'sans-serif',
        }}
      >
        FT
      </div>
    ),
    { width: 512, height: 512 }
  );
}
