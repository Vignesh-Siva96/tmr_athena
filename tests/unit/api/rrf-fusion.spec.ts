import { describe, it, expect } from 'vitest'

// ─── RRF (Reciprocal Rank Fusion) arithmetic ──────────────────────────────────
// Extracted logic from RetrievalService for unit testing.

interface RankedItem {
  id: string
  rank: number  // 0-based rank within a list
}

const K = 60

function rrfScore(rank: number): number {
  return 1 / (K + rank + 1)
}

function fuseLists(lists: RankedItem[][]): Map<string, number> {
  const scores = new Map<string, number>()
  for (const list of lists) {
    for (const item of list) {
      scores.set(item.id, (scores.get(item.id) ?? 0) + rrfScore(item.rank))
    }
  }
  return scores
}

function topN(scores: Map<string, number>, n: number): string[] {
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => id)
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('RRF fusion', () => {
  describe('score arithmetic', () => {
    it('computes correct score for rank 0', () => {
      // 1 / (60 + 0 + 1) = 1/61 ≈ 0.016393
      expect(rrfScore(0)).toBeCloseTo(1 / 61)
    })

    it('computes correct score for rank 59 (last in top-60)', () => {
      // 1 / (60 + 59 + 1) = 1/120 ≈ 0.008333
      expect(rrfScore(59)).toBeCloseTo(1 / 120)
    })

    it('higher ranks produce lower scores', () => {
      expect(rrfScore(0)).toBeGreaterThan(rrfScore(10))
      expect(rrfScore(10)).toBeGreaterThan(rrfScore(49))
    })
  })

  describe('single list', () => {
    it('preserves rank order from a single list', () => {
      const list = [
        { id: 'a', rank: 0 },
        { id: 'b', rank: 1 },
        { id: 'c', rank: 2 },
      ]
      const scores = fuseLists([list])
      expect(topN(scores, 3)).toEqual(['a', 'b', 'c'])
    })
  })

  describe('two lists fusion', () => {
    it('boosts items that appear in both lists', () => {
      const dense = [
        { id: 'chunk-kb', rank: 5 },
        { id: 'chunk-only-dense', rank: 0 },
      ]
      const sparse = [
        { id: 'chunk-kb', rank: 3 },
        { id: 'chunk-only-sparse', rank: 0 },
      ]
      const scores = fuseLists([dense, sparse])
      // chunk-kb appears in both → boosted score
      const kbScore = scores.get('chunk-kb')!
      const denseOnlyScore = scores.get('chunk-only-dense')!
      const sparseOnlyScore = scores.get('chunk-only-sparse')!

      // chunk-only-dense rank 0 in dense list only
      // chunk-kb rank 5 in dense + rank 3 in sparse → dual appearance boost
      expect(kbScore).toBeGreaterThan(denseOnlyScore)
      expect(kbScore).toBeGreaterThan(sparseOnlyScore)
    })

    it('handles disjoint lists correctly', () => {
      const listA = [{ id: 'a1', rank: 0 }, { id: 'a2', rank: 1 }]
      const listB = [{ id: 'b1', rank: 0 }, { id: 'b2', rank: 1 }]
      const scores = fuseLists([listA, listB])
      // a1 and b1 both at rank 0 in their respective lists → tied
      expect(scores.get('a1')).toBeCloseTo(scores.get('b1')!)
      // a2 and b2 both at rank 1 → tied
      expect(scores.get('a2')).toBeCloseTo(scores.get('b2')!)
    })
  })

  describe('top-N selection', () => {
    it('returns at most N results', () => {
      const list = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, rank: i }))
      const scores = fuseLists([list])
      expect(topN(scores, 5)).toHaveLength(5)
    })

    it('empty lists produce empty results', () => {
      const scores = fuseLists([])
      expect(topN(scores, 5)).toHaveLength(0)
    })

    it('item appearing at rank 0 in both lists beats rank 0 in single list', () => {
      const item1 = { id: 'dual', rank: 0 }
      const item2 = { id: 'single', rank: 0 }
      const scores = fuseLists([[item1], [item1, item2]])
      // 'dual' appears twice at rank 0: score = 2/61 ≈ 0.0328
      // 'single' appears once at rank 1: score = 1/62 ≈ 0.0161
      expect(scores.get('dual')!).toBeGreaterThan(scores.get('single')!)
    })
  })

  describe('hand-computed expected outputs', () => {
    it('matches manually computed scores for a 3-item scenario', () => {
      // dense: [x@0, y@1, z@2]
      // sparse: [z@0, x@1]
      // x: 1/(60+0+1) + 1/(60+1+1) = 1/61 + 1/62
      // y: 1/(60+1+1) = 1/62 (only in dense at rank 1)
      // z: 1/(60+2+1) + 1/(60+0+1) = 1/63 + 1/61
      const dense = [{ id: 'x', rank: 0 }, { id: 'y', rank: 1 }, { id: 'z', rank: 2 }]
      const sparse = [{ id: 'z', rank: 0 }, { id: 'x', rank: 1 }]
      const scores = fuseLists([dense, sparse])

      expect(scores.get('x')).toBeCloseTo(1 / 61 + 1 / 62, 5)
      expect(scores.get('y')).toBeCloseTo(1 / 62, 5)
      expect(scores.get('z')).toBeCloseTo(1 / 63 + 1 / 61, 5)

      // x and z are tied; y is lower
      const top = topN(scores, 3)
      expect(top).toContain('x')
      expect(top).toContain('z')
      expect(top[top.length - 1]).toBe('y')
    })
  })
})
