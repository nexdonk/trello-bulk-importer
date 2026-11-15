import { getCredentials } from '../config.js';

/**
 * Minimal logger that redacts the configured Trello key/token and anything that looks like
 * key=/token= query params or OAuth headers. Always use this instead of console.* on the server.
 */
function redact(input: unknown): string {
  let text: string;
  if (input instanceof Error) text = `${input.name}: ${input.message}`;
  else if (typeof input === 'string') text = input;
  else {
    try {
      text = JSON.stringify(input);
    } catch {
      text = String(input);
    }
  }
  const { apiKey, apiToken } = getCredentials();
  for (const secret of [apiKey, apiToken]) {
    if (secret && secret.length >= 6) text = text.split(secret).join('[REDACTED]');
  }
  return text
    .replace(/((?:key|token)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(oauth_(?:consumer_key|token)=")[^"]*"/gi, '$1[REDACTED]"');
}

function stamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info: (...args: unknown[]) => console.log(stamp(), 'INFO ', args.map(redact).join(' ')),
  warn: (...args: unknown[]) => console.warn(stamp(), 'WARN ', args.map(redact).join(' ')),
  error: (...args: unknown[]) => console.error(stamp(), 'ERROR', args.map(redact).join(' ')),
};
