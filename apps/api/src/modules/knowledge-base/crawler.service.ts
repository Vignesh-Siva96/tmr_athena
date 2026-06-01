import { Injectable, Logger } from '@nestjs/common'
import * as cheerio from 'cheerio'
import { PrismaService } from '../database/prisma.service'

export interface CrawledPage {
  url: string
  html: string
  title: string | null
}

const MAX_DEPTH = 5
const MAX_PAGES = 500
const FETCH_TIMEOUT_MS = 15_000
const CONCURRENCY = 6
const RETRY_ATTEMPTS = 3
const RETRY_BASE_MS = 500
const USER_AGENT = 'Mozilla/5.0 (compatible; TMRKnowledgeBot/1.0)'

@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name)

  constructor(private readonly db: PrismaService) {}

  async crawl(
    rootUrl: string,
    opts: { mode?: 'full' | 'incremental'; onPage?: (page: CrawledPage) => Promise<void> } = {},
  ): Promise<CrawledPage[]> {
    this.logger.log(`Starting crawl of ${rootUrl} (mode=${opts.mode ?? 'full'})`)

    const root = new URL(rootUrl)
    const rootPath = root.pathname.endsWith('/') ? root.pathname : root.pathname + '/'
    const origin = root.origin

    // --- Tier 0: Discover sitemaps via robots.txt ---
    const robotsSitemaps = await this.fetchRobotsSitemaps(origin)

    // --- Tier 1: Try sitemap (robots.txt first, then hardcoded candidates) ---
    const sitemapCandidates = [
      ...robotsSitemaps,
      `${origin}/sitemap.xml`,
      `${origin}/sitemap_index.xml`,
    ]

    const { urls: sitemapUrls, lastmods } = await this.fetchSitemapUrlsWithLastmod(
      origin,
      rootPath,
      sitemapCandidates,
    )

    if (sitemapUrls.length > 0) {
      this.logger.log(`Sitemap found: ${sitemapUrls.length} URLs to crawl`)

      // In incremental mode, skip pages whose lastmod hasn't changed since last fetch
      let urlsToFetch = sitemapUrls
      if (opts.mode === 'incremental') {
        urlsToFetch = await this.filterByLastmod(sitemapUrls, lastmods)
        this.logger.log(
          `Incremental mode: ${urlsToFetch.length}/${sitemapUrls.length} pages changed since last index`,
        )
      }

      const pages = await this.fetchConcurrent(
        urlsToFetch.slice(0, MAX_PAGES),
        opts.onPage,
      )
      return pages
    }

    // --- Tier 2: BFS crawl ---
    this.logger.log(`No sitemap found — falling back to BFS crawl`)
    return this.bfsCrawl(rootUrl, origin, rootPath, opts.onPage)
  }

  /** Read robots.txt and return any Sitemap: directives. */
  private async fetchRobotsSitemaps(origin: string): Promise<string[]> {
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) return []
      const text = await res.text()
      const sitemaps: string[] = []
      for (const line of text.split('\n')) {
        const match = /^Sitemap:\s*(.+)/i.exec(line.trim())
        if (match) sitemaps.push(match[1].trim())
      }
      return sitemaps
    } catch {
      return []
    }
  }

  /**
   * Try sitemap candidates in order, returning URLs + lastmod map.
   * Supports .xml.gz (gzipped) sitemaps and sitemap indexes.
   */
  private async fetchSitemapUrlsWithLastmod(
    origin: string,
    rootPath: string,
    candidates: string[],
  ): Promise<{ urls: string[]; lastmods: Map<string, Date> }> {
    const seen = new Set<string>()

    for (const sitemapUrl of candidates) {
      if (seen.has(sitemapUrl)) continue
      seen.add(sitemapUrl)

      try {
        const res = await fetch(sitemapUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!res.ok) continue

        let xml: string
        if (sitemapUrl.endsWith('.gz')) {
          // Decompress gzipped sitemap using DecompressionStream (Node 18+)
          const buffer = await res.arrayBuffer()
          const ds = new DecompressionStream('gzip')
          const writer = ds.writable.getWriter()
          const reader = ds.readable.getReader()
          writer.write(new Uint8Array(buffer))
          writer.close()
          const chunks: Uint8Array[] = []
          let done = false
          while (!done) {
            const { value, done: d } = await reader.read()
            if (value) chunks.push(value)
            done = d
          }
          xml = new TextDecoder().decode(
            chunks.reduce((acc, c) => {
              const merged = new Uint8Array(acc.length + c.length)
              merged.set(acc)
              merged.set(c, acc.length)
              return merged
            }, new Uint8Array(0)),
          )
        } else {
          xml = await res.text()
        }

        const urls: string[] = []
        const lastmods = new Map<string, Date>()

        if (xml.includes('<sitemapindex')) {
          // Sitemap index — recurse into nested sitemaps
          const nestedRe = /<sitemap>\s*<loc>([^<]+)<\/loc>/g
          const nestedSitemaps: string[] = []
          let m: RegExpExecArray | null
          while ((m = nestedRe.exec(xml)) !== null) {
            nestedSitemaps.push(m[1].trim())
          }
          const nested = await this.fetchSitemapUrlsWithLastmod(origin, rootPath, nestedSitemaps)
          for (const [k, v] of nested.lastmods) lastmods.set(k, v)
          urls.push(...nested.urls)
        } else {
          // Parse <url> entries with optional <lastmod>
          const urlBlockRe = /<url>([\s\S]*?)<\/url>/g
          let block: RegExpExecArray | null
          while ((block = urlBlockRe.exec(xml)) !== null) {
            const locMatch = /<loc>([^<]+)<\/loc>/.exec(block[1])
            const lastmodMatch = /<lastmod>([^<]+)<\/lastmod>/.exec(block[1])
            if (!locMatch) continue
            const u = locMatch[1].trim()
            if (!this.isSameOriginAndPath(u, origin, rootPath)) continue
            urls.push(u)
            if (lastmodMatch) {
              const d = new Date(lastmodMatch[1].trim())
              if (!isNaN(d.getTime())) lastmods.set(u, d)
            }
          }
        }

        if (urls.length > 0) return { urls, lastmods }
      } catch {
        // Not found or error — try next candidate
      }
    }

    return { urls: [], lastmods: new Map() }
  }

  /**
   * Filter sitemap URLs to only those changed since the last successful index.
   * Pages with no lastmod, or whose lastmod > source.fetchedAt, are included.
   */
  private async filterByLastmod(
    urls: string[],
    lastmods: Map<string, Date>,
  ): Promise<string[]> {
    if (lastmods.size === 0) return urls // no lastmod data — fetch all

    const sources = await this.db.knowledgeSource.findMany({
      where: { url: { in: urls } },
      select: { url: true, fetchedAt: true },
    })
    const fetchedAtMap = new Map(
      sources
        .filter((s) => s.fetchedAt !== null)
        .map((s) => [s.url, s.fetchedAt as Date]),
    )

    return urls.filter((url) => {
      const lm = lastmods.get(url)
      const fa = fetchedAtMap.get(url)
      if (!lm || !fa) return true // no lastmod or never fetched — include
      return lm > fa
    })
  }

  /** Fetch a list of URLs with bounded concurrency (CONCURRENCY slots). */
  private async fetchConcurrent(
    urls: string[],
    onPage?: (page: CrawledPage) => Promise<void>,
  ): Promise<CrawledPage[]> {
    const pages: CrawledPage[] = []
    const queue = [...urls]
    const inFlight = new Set<Promise<void>>()

    const launchNext = (): void => {
      while (inFlight.size < CONCURRENCY && queue.length > 0) {
        const url = queue.shift()!
        const task = (async () => {
          const page = await this.fetchPage(url)
          if (page) {
            pages.push(page)
            if (onPage) await onPage(page)
          }
        })()
          .catch((err) => {
            this.logger.warn(`fetchConcurrent: error for ${url}: ${String(err)}`)
          })
          .finally(() => {
            inFlight.delete(task)
            launchNext()
          })
        inFlight.add(task)
      }
    }

    launchNext()

    // Wait until all in-flight tasks settle
    while (inFlight.size > 0) {
      await Promise.race(inFlight)
    }

    return pages
  }

  private async bfsCrawl(
    rootUrl: string,
    origin: string,
    rootPath: string,
    onPage?: (page: CrawledPage) => Promise<void>,
  ): Promise<CrawledPage[]> {
    const visited = new Set<string>()
    const queue: Array<{ url: string; depth: number }> = [{ url: rootUrl, depth: 0 }]
    const pages: CrawledPage[] = []

    while (queue.length > 0 && pages.length < MAX_PAGES) {
      // Take up to CONCURRENCY items from the front of the queue
      const batch = queue.splice(0, CONCURRENCY)
      const settled = await Promise.allSettled(
        batch.map(async (item) => {
          const normalized = normalizeUrl(item.url)
          if (visited.has(normalized)) return
          visited.add(normalized)
          if (item.depth > MAX_DEPTH) return

          const page = await this.fetchPage(item.url)
          if (!page) return

          pages.push(page)
          if (onPage) await onPage(page)

          // Enqueue discovered links
          const $ = cheerio.load(page.html)
          $('a[href]').each((_, el) => {
            const href = $(el).attr('href')
            if (!href) return
            try {
              const abs = new URL(href, item.url).href.split('#')[0]
              if (this.isSameOriginAndPath(abs, origin, rootPath) && !visited.has(normalizeUrl(abs))) {
                queue.push({ url: abs, depth: item.depth + 1 })
              }
            } catch {
              // Invalid URL — skip
            }
          })
        }),
      )

      // Log any BFS errors but keep going
      for (const result of settled) {
        if (result.status === 'rejected') {
          this.logger.warn(`BFS crawl error: ${String(result.reason)}`)
        }
      }
    }

    return pages
  }

  async fetchPage(url: string): Promise<CrawledPage | null> {
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })

        if (!res.ok) {
          // 429/503 — retryable; 4xx client errors are not
          if ((res.status === 429 || res.status >= 500) && attempt < RETRY_ATTEMPTS) {
            await delay(RETRY_BASE_MS * attempt)
            continue
          }
          this.logger.debug(`fetchPage: ${url} returned ${res.status}`)
          return null
        }

        const contentType = res.headers.get('content-type') ?? ''
        if (!contentType.includes('text/html')) {
          this.logger.debug(`fetchPage: ${url} is not HTML (${contentType})`)
          return null
        }

        const html = await res.text()

        if (/<meta[^>]+noindex/i.test(html)) {
          this.logger.debug(`fetchPage: ${url} has noindex — skipping`)
          return null
        }

        const $ = cheerio.load(html)
        const title = $('title').first().text().trim() || null

        return { url, html, title }
      } catch (err) {
        if (attempt < RETRY_ATTEMPTS) {
          this.logger.debug(`fetchPage: ${url} attempt ${attempt} failed — retrying`)
          await delay(RETRY_BASE_MS * attempt)
          continue
        }
        this.logger.warn(`fetchPage error for ${url}: ${String(err)}`)
        return null
      }
    }
    return null
  }

  private isSameOriginAndPath(url: string, origin: string, rootPath: string): boolean {
    try {
      const parsed = new URL(url)
      return (
        parsed.origin === origin &&
        (parsed.pathname === rootPath.replace(/\/$/, '') ||
          parsed.pathname.startsWith(rootPath))
      )
    } catch {
      return false
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.href.replace(/\/$/, '')
  } catch {
    return url
  }
}
