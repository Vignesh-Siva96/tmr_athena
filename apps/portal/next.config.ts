import type { NextConfig } from 'next'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load monorepo root .env so NEXT_PUBLIC_* vars are available at build time
config({ path: resolve(__dirname, '../../.env'), override: false })

const nextConfig: NextConfig = {
  transpilePackages: ['@tmr/ui'],
  env: {
    NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001',
    NEXT_PUBLIC_ASSETS_URL: process.env['NEXT_PUBLIC_ASSETS_URL'] ?? '',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'assets.gox.ai' },
    ],
  },
}

export default nextConfig
