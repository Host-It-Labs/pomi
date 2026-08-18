type PreparationResponse = { status: number };

type PrepareAssistantVoiceOptions<
  TBody,
  TResponse extends PreparationResponse,
> = {
  body: TBody;
  prepare: (body: TBody) => Promise<TResponse>;
  isAuthenticated: () => boolean;
  onRetry: () => void;
  waitForRetry: (milliseconds: number) => Promise<void>;
};

const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 5_000;
const MAX_ATTEMPTS = 5;

export async function prepareAssistantVoiceWithRetry<
  TBody,
  TResponse extends PreparationResponse,
>({
  body,
  prepare,
  isAuthenticated,
  onRetry,
  waitForRetry,
}: PrepareAssistantVoiceOptions<TBody, TResponse>): Promise<TResponse> {
  let attempt = 0;
  for (;;) {
    let response: TResponse | null = null;
    let failure: unknown;
    try {
      response = await prepare(body);
      if (response.status < 500) return response;
      failure = new Error(`Assistant preparation failed (${response.status})`);
    } catch (error) {
      failure = error;
    }
    if (!isAuthenticated() || attempt + 1 >= MAX_ATTEMPTS) throw failure;
    onRetry();
    const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
    attempt += 1;
    await waitForRetry(delay);
  }
}

export function waitForAssistantRetry(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}
