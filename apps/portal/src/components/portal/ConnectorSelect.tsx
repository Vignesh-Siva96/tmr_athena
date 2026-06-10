'use client'
import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { ChevronDown, Search } from 'lucide-react'

export interface DropdownOption {
  value: string
  label: string
  icon?: string
}

interface OptionSelectProps {
  value: string
  onChange: (value: string) => void
  options: DropdownOption[]
  placeholder?: string
}

function OptionIcon({ icon, label }: { icon: string; label: string }) {
  const assetsUrl = process.env.NEXT_PUBLIC_ASSETS_URL ?? ''
  const src = icon.startsWith('http') ? icon : `${assetsUrl}/${icon}.png`
  return <Image src={src} alt={label} width={16} height={16} />
}

export function OptionSelect({ value, onChange, options, placeholder = 'Select an option…' }: OptionSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find((c) => c.value === value) ?? null

  const filtered = search
    ? options.filter((c) => c.label.toLowerCase().includes(search.toLowerCase()))
    : options

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', height: 40, padding: '0 12px',
          display: 'flex', alignItems: 'center', gap: 8,
          border: '1px solid var(--p-border)', borderRadius: 'var(--r-sm)',
          background: '#fff', cursor: 'pointer', textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        {selected ? (
          <>
            {selected.icon && <OptionIcon icon={selected.icon} label={selected.label} />}
            <span style={{ flex: 1, fontSize: 14, color: 'var(--p-text)' }}>{selected.label}</span>
          </>
        ) : (
          <span style={{ flex: 1, fontSize: 14, color: 'var(--p-text-4)' }}>{placeholder}</span>
        )}
        <ChevronDown size={15} style={{ color: 'var(--p-text-3)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
          background: '#fff', border: '1px solid var(--p-border)', borderRadius: 'var(--r-md)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--p-border-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px', border: '1px solid var(--p-border)', borderRadius: 'var(--r-sm)', background: 'var(--p-surface)' }}>
              <Search size={13} style={{ color: 'var(--p-text-4)', flexShrink: 0 }} />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--p-text)', fontFamily: 'inherit' }}
              />
            </div>
          </div>

          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {value && (
              <button type="button" onClick={() => { onChange(''); setOpen(false); setSearch('') }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', borderBottom: '1px solid var(--p-border-2)' }}>
                <span style={{ fontSize: 13, color: 'var(--p-text-3)' }}>— Clear selection</span>
              </button>
            )}
            {filtered.length === 0 ? (
              <p style={{ padding: '16px 12px', fontSize: 13, color: 'var(--p-text-4)', textAlign: 'center', margin: 0 }}>No options found</p>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); setSearch('') }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                    background: value === opt.value ? 'var(--p-accent-bg)' : 'transparent',
                    borderLeft: value === opt.value ? '2px solid var(--p-accent)' : '2px solid transparent',
                  }}
                >
                  {opt.icon && <OptionIcon icon={opt.icon} label={opt.label} />}
                  <span style={{ fontSize: 14, color: value === opt.value ? 'var(--p-accent)' : 'var(--p-text)', fontWeight: value === opt.value ? 500 : 400 }}>
                    {opt.label}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** @deprecated Use OptionSelect with options array instead */
export function ConnectorSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <OptionSelect value={value} onChange={onChange} options={[]} placeholder="Select a connector…" />
}
