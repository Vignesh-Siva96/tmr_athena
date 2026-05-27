const PREFIX_RE = /^(re|fwd?|fw):\s*/i

export function stripSubjectPrefixes(subject: string): string {
  let s = subject
  while (PREFIX_RE.test(s)) s = s.replace(PREFIX_RE, '')
  return s.trim()
}
