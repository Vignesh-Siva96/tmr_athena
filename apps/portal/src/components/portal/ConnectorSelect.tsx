'use client'
import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { ChevronDown, Search } from 'lucide-react'

interface Connector {
  key: string
  label: string
}
// Todo rempove color and initials
const CONNECTORS: Connector[] = [
  { key: 'amazonseller', label: 'Amazon Seller',       },
  { key: 'amazonads',  label: 'Amazon Ads',            },
  { key: 'appleads',  label: 'Apple Search Ads',       },
  { key: 'fads',      label: 'Facebook Ads',           },
  { key: 'fins',      label: 'Facebook Insights',      },
  { key: 'ga4',       label: 'Google Analytics 4',     },
  { key: 'gadw',      label: 'Google Ads',             },
  { key: 'gmb',       label: 'Google My Business',     },
  { key: 'gsc',       label: 'Google Search Console',  },
  { key: 'hubspot',   label: 'HubSpot',                },
  { key: 'ins',       label: 'Instagram Insights',     },
  { key: 'klaviyo',   label: 'Klaviyo',                },
  { key: 'lads',      label: 'LinkedIn Ads',           },
  { key: 'lps',       label: 'LinkedIn Pages',         },
  { key: 'msads',     label: 'Microsoft Ads',          },
  { key: 'pinads',    label: 'Pinterest Ads',          },
  { key: 'redditads', label: 'Reddit Ads',             },
  { key: 'shopify',   label: 'Shopify',                },
  { key: 'snapads',   label: 'Snapchat Ads',           },
  { key: 'ttads',     label: 'TikTok Ads',             },
  { key: 'twitterads',label: 'Twitter Ads',            },
  { key: 'wc',        label: 'WooCommerce',            },
  { key: 'ya',        label: 'Youtube Analytics',      },
]

interface ConnectorSelectProps {
  value: string
  onChange: (value: string) => void
}

function ConnectorIcon({ connector }: { connector: Connector }) {
  const url = `${process.env.NEXT_PUBLIC_ASSETS_URL}/${connector.key}.png`;
  return <Image src={url} alt={connector.label} width={16} height={16} />;
}

export function ConnectorSelect({ value, onChange }: ConnectorSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = CONNECTORS.find((c) => c.label === value) ?? null

  const filtered = search
    ? CONNECTORS.filter((c) => c.label.toLowerCase().includes(search.toLowerCase()))
    : CONNECTORS

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
      {/* Trigger */}
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
            <ConnectorIcon connector={selected}/>
            <span style={{ flex: 1, fontSize: 14, color: 'var(--p-text)' }}>{selected.label}</span>
          </>
        ) : (
          <span style={{ flex: 1, fontSize: 14, color: 'var(--p-text-4)' }}>Select a connector…</span>
        )}
        <ChevronDown size={15} style={{ color: 'var(--p-text-3)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
          background: '#fff', border: '1px solid var(--p-border)', borderRadius: 'var(--r-md)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}>
          {/* Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--p-border-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px', border: '1px solid var(--p-border)', borderRadius: 'var(--r-sm)', background: 'var(--p-surface)' }}>
              <Search size={13} style={{ color: 'var(--p-text-4)', flexShrink: 0 }} />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search connectors…"
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--p-text)', fontFamily: 'inherit' }}
              />
            </div>
          </div>

          {/* Options */}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {/* Clear option */}
            {value && (
              <button type="button" onClick={() => { onChange(''); setOpen(false); setSearch('') }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', borderBottom: '1px solid var(--p-border-2)' }}>
                <span style={{ fontSize: 13, color: 'var(--p-text-3)' }}>— No connector</span>
              </button>
            )}
            {filtered.length === 0 ? (
              <p style={{ padding: '16px 12px', fontSize: 13, color: 'var(--p-text-4)', textAlign: 'center', margin: 0 }}>No connectors found</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => { onChange(c.label); setOpen(false); setSearch('') }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                    background: value === c.label ? 'var(--p-accent-bg)' : 'transparent',
                    borderLeft: value === c.label ? '2px solid var(--p-accent)' : '2px solid transparent',
                  }}
                >
                  <ConnectorIcon connector={c}/>
                  <span style={{ fontSize: 14, color: value === c.label ? 'var(--p-accent)' : 'var(--p-text)', fontWeight: value === c.label ? 500 : 400 }}>
                    {c.label}
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
