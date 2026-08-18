export const REDACTION_MARKER = '[REDACTED]';

export const SENSITIVE_REDACTION_KEY_PATTERN =
  /authorization|cookie|password|passphrase|secret|token|api[-_]?key|prompt|transcript|audio|description|title|content|body|request|response|user|extra|data/i;

export const SENSITIVE_REDACTION_TEXT_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[^\s,;]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /((?:authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret|token)\s*[:=]\s*)[^\s,;]+/gi,
  /((?:"|')?(?:authorization|cookie|password|secret|token|prompt|transcript|audio|description|title|content|body|request|response|user|extra|data)(?:"|')?\s*:\s*)("[^"]*"|'[^']*'|[^,}\s]+)/gi,
];
