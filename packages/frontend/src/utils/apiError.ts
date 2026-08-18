export function getApiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object' || !('message' in body)) {
    return fallback;
  }

  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }

  if (Array.isArray(message)) {
    const messages = message.filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0
    );
    if (messages.length > 0) return messages.join('; ');
  }

  return fallback;
}
