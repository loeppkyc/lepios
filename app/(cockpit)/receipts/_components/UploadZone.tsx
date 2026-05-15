'use client'

import { useRef, useState } from 'react'

interface UploadZoneProps {
  onUploaded: (result: { receipt_id: string; vendor: string; total: number; match_confidence?: number }) => void
}

export function UploadZone({ onUploaded }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/receipts/upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? `Upload failed (${res.status})`)
      }
      const data = await res.json() as { receipt_id: string; vendor: string; total: number; match_confidence?: number }
      onUploaded(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    void upload(file)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
      className={[
        'flex flex-col items-center justify-center rounded-[var(--radius)] border-2 border-dashed px-8 py-12 text-center transition-colors cursor-pointer',
        dragging
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
          : 'border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-accent)]/50',
      ].join(' ')}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {uploading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Scanning receipt...</p>
      ) : (
        <>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            Drop a receipt here or click to upload
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            JPEG, PNG, WebP, PDF — max 20 MB
          </p>
        </>
      )}

      {error && (
        <p className="mt-3 text-xs text-[var(--color-critical)]">{error}</p>
      )}
    </div>
  )
}
