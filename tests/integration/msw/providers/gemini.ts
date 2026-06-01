import { http, HttpResponse } from 'msw'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Default Gemini handler: returns a neutral classification + zero signals.
 * Override per test to simulate churn, advocacy, or specific scores.
 */
export const geminiHandlers = [
  http.post(`${BASE}/gemini-2.5-flash-lite:generateContent`, () =>
    HttpResponse.json({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  sentiment: { score: 0.0, label: 'NEUTRAL' },
                  churnSignal: null,
                  advocacySignal: null,
                  topic: 'General Inquiry',
                  csatScore: 4,
                  effortScore: 3,
                  summary: 'Neutral interaction with no specific signals.',
                  reasoning: 'Default mocked response.',
                }),
              },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
    }),
  ),
]
