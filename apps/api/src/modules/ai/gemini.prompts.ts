export const ANALYZE_MESSAGE_PROMPT = (body: string) => `
Analyze the following customer support message and extract all signals in one pass.

Message:
"""
${body}
"""

Respond ONLY with a JSON object in this exact format (no markdown, no extra keys):
{
  "sentiment": {
    "score": <float -1.0 to 1.0>,
    "label": "<NEGATIVE|NEUTRAL|POSITIVE>"
  },
  "churnSignal": <null or { "detected": true, "quote": "<exact phrase from message>", "reason": "<one sentence>" }>,
  "advocacySignal": <null or { "detected": true, "quote": "<exact phrase from message>", "reason": "<one sentence>" }>
}

Rules:
- sentiment.score < -0.2 → NEGATIVE; > 0.2 → POSITIVE; otherwise NEUTRAL
- churnSignal: set if message contains explicit cancellation intent, switching to competitor, or serious frustration threatening to leave. Only flag strong signals, not minor complaints.
- advocacySignal: set if message contains clear praise, recommending the product, or strong satisfaction. Only flag genuine enthusiasm.
- Both signals can be null simultaneously (most messages).
`.trim()

export const CLASSIFY_AND_SCORE_TICKET_PROMPT = (
  title: string,
  messages: string,
  existingTopics: string[],
) => `
You are a customer satisfaction analyst. Analyze the following resolved support ticket and return three things in one response: topic classification, CSAT inference, and customer effort score.

Ticket title: "${title}"
Conversation:
"""
${messages}
"""

Existing topic clusters (prefer these if they fit; otherwise create a new one):
${existingTopics.length > 0 ? existingTopics.map(t => `- ${t}`).join('\n') : '(none yet)'}

Respond ONLY with a JSON object in this exact format (no markdown, no extra keys):
{
  "topic": {
    "name": "<3–8 word cluster name>",
    "isNewTopic": <true|false>
  },
  "csat": {
    "rating": <1-5>,
    "reasoning": "<one sentence>"
  },
  "effort": {
    "score": <1-5>
  },
  "summary": "<1-2 sentences explaining why these specific CSAT and effort scores were given>"
}

CSAT scale: 1=Very dissatisfied, 2=Dissatisfied, 3=Neutral, 4=Satisfied, 5=Very satisfied
Effort scale (CES proxy): 1=Effortless resolution, 2=Easy, 3=Moderate, 4=Difficult, 5=Very difficult/frustrating
summary: be brief and direct — state the key reason for each score, no filler words.
`.trim()
