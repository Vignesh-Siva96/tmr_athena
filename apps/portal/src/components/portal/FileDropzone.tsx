'use client'
import { useRef, useState, useCallback } from 'react'
import { Upload, X, Link as LinkIcon } from 'lucide-react'

interface UploadedFile {
  name: string
  size: number
  id?: string
  file?: File
}

interface FileDropzoneProps {
  files: UploadedFile[]
  onFilesChange: (files: UploadedFile[]) => void
  linkUrl: string
  onLinkUrlChange: (url: string) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileDropzone({ files, onFilesChange, linkUrl, onLinkUrlChange }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const addFiles = useCallback((newFiles: File[]) => {
    const validFiles = newFiles.filter((f) => f.size <= 10 * 1024 * 1024)
    const mapped: UploadedFile[] = validFiles.map((f) => ({ name: f.name, size: f.size, file: f }))
    onFilesChange([...files, ...mapped])
  }, [files, onFilesChange])

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index))
  }

  return (
    <div>
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          addFiles(Array.from(e.dataTransfer.files))
        }}
        style={{
          border: `1.5px dashed ${isDragging ? 'var(--p-accent)' : 'var(--p-border)'}`,
          borderRadius: 'var(--r-md)',
          padding: '28px 20px',
          textAlign: 'center',
          background: isDragging ? 'var(--p-accent-bg)' : 'var(--p-surface-2)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          transition: 'all 120ms',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: '#fff',
            border: '1px solid var(--p-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--p-text-3)',
          }}
        >
          <Upload size={18} />
        </div>
        <div style={{ fontSize: 14, color: 'var(--p-text-2)' }}>
          <strong style={{ color: 'var(--p-text)', fontWeight: 600 }}>Drag files here</strong>, or{' '}
          <span style={{ color: 'var(--p-accent)', fontWeight: 500 }}>click to browse</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--p-text-4)' }}>
          Supports images, PDFs, and links · Max 10MB each
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
      />

      {/* File chips */}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {files.map((file, i) => (
            <div
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px 6px 10px',
                border: '1px solid var(--p-border)',
                borderRadius: 'var(--r-sm)',
                background: '#fff',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--p-success)',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--p-text)' }}>
                {file.name}
              </span>
              <span style={{ fontSize: 11, color: 'var(--p-text-4)', fontVariantNumeric: 'tabular-nums' }}>
                {formatSize(file.size)}
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--p-text-4)',
                  background: 'var(--p-surface)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Link input */}
      <div
        style={{
          marginTop: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          border: '1px solid var(--p-border)',
          borderRadius: 'var(--r-sm)',
          padding: '0 12px',
          height: 36,
          background: '#fff',
        }}
      >
        <LinkIcon size={14} style={{ color: 'var(--p-text-4)', flexShrink: 0 }} />
        <input
          type="url"
          value={linkUrl}
          onChange={(e) => onLinkUrlChange(e.target.value)}
          placeholder="Or paste a link (Loom, Sheets, Data Studio…)"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontFamily: 'inherit',
            fontSize: 13,
            color: 'var(--p-text)',
            background: 'transparent',
          }}
        />
      </div>
    </div>
  )
}
