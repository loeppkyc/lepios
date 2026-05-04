import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'LEPIOS — Colin Loeppky\'s Personal AI'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0d0d0d',
          fontFamily: 'monospace',
        }}
      >
        {/* Accent bar */}
        <div
          style={{
            width: 64,
            height: 6,
            background: '#4fc3f7',
            borderRadius: 3,
            marginBottom: 32,
          }}
        />

        {/* LEPIOS wordmark */}
        <div
          style={{
            fontSize: 96,
            fontWeight: 900,
            letterSpacing: '0.18em',
            color: '#ffffff',
            marginBottom: 16,
          }}
        >
          LEPIOS
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 24,
            letterSpacing: '0.12em',
            color: '#666666',
            textTransform: 'uppercase',
          }}
        >
          Colin Loeppky&apos;s Personal AI
        </div>

        {/* Bottom accent */}
        <div
          style={{
            position: 'absolute',
            bottom: 48,
            fontSize: 14,
            letterSpacing: '0.2em',
            color: '#333333',
            textTransform: 'uppercase',
          }}
        >
          lepios-one.vercel.app
        </div>
      </div>
    ),
    { ...size },
  )
}
