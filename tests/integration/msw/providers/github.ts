import { http, HttpResponse } from 'msw'

const BASE = 'https://api.github.com'

export const githubHandlers = [
  // OAuth token exchange
  http.post('https://github.com/login/oauth/access_token', () =>
    HttpResponse.json({ access_token: 'gh_test_token', token_type: 'bearer', scope: 'repo' }),
  ),

  // Authenticated user lookup
  http.get(`${BASE}/user`, () => HttpResponse.json({ id: 12345, login: 'test-agent' })),

  // Repository listing (paginated)
  http.get(`${BASE}/user/repos`, () =>
    HttpResponse.json([
      { full_name: 'test-agent/example-repo', private: false, description: 'Test repo' },
    ]),
  ),

  // Issue creation
  http.post(`${BASE}/repos/:owner/:repo/issues`, async ({ params, request }) => {
    const body = (await request.json()) as { title: string; body?: string; labels?: string[] }
    return HttpResponse.json({
      number: 42,
      html_url: `https://github.com/${params.owner}/${params.repo}/issues/42`,
      title: body.title,
      state: 'open',
      labels: (body.labels ?? []).map((name) => ({ name })),
    })
  }),

  // Issue read
  http.get(`${BASE}/repos/:owner/:repo/issues/:number`, ({ params }) =>
    HttpResponse.json({
      number: Number(params.number),
      html_url: `https://github.com/${params.owner}/${params.repo}/issues/${params.number}`,
      title: 'Stub issue',
      state: 'open',
      labels: [],
    }),
  ),

  // Label add / remove
  http.post(`${BASE}/repos/:owner/:repo/issues/:number/labels`, () => HttpResponse.json([])),
  http.delete(`${BASE}/repos/:owner/:repo/issues/:number/labels/:name`, () =>
    new HttpResponse(null, { status: 200 }),
  ),
]
