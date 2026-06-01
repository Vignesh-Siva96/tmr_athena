import { http, HttpResponse } from 'msw'

const BASE = 'https://graph.microsoft.com/v1.0/me'

export const graphHandlers = [
  http.get(`${BASE}/messages/delta`, () =>
    HttpResponse.json({ value: [], '@odata.deltaLink': `${BASE}/messages/delta?$deltatoken=stub` }),
  ),
  http.get(`${BASE}/messages/:id`, ({ params }) =>
    HttpResponse.json({ id: params.id, conversationId: 'conv-1', subject: '', body: { content: '', contentType: 'text' } }),
  ),
  http.post(`${BASE}/sendMail`, () => new HttpResponse(null, { status: 202 })),
]
