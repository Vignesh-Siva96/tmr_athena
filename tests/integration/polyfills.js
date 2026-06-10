// Node 18 doesn't expose `File` as a global. Polyfill from `buffer` so that
// undici (pulled in by cheerio v1) can load without "File is not defined".
if (typeof File === 'undefined') {
  const { File } = require('buffer')
  global.File = File
}

// Node 18 doesn't expose `crypto` as a global (added in Node 20).
// @nestjs/schedule's cron parser uses it for UUID generation.
if (typeof crypto === 'undefined') {
  const { webcrypto } = require('node:crypto')
  global.crypto = webcrypto
}
