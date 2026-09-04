import { describe, expect, it } from 'vitest';
import { alignDevelopmentLoopbackOrigin } from './backendUrl';

describe('backend origin resolution', () => {
  it('uses the frontend loopback hostname for HTTP cookie compatibility', () => {
    expect(
      alignDevelopmentLoopbackOrigin(
        'http://localhost:3000',
        'http://127.0.0.1:1420'
      )
    ).toBe('http://127.0.0.1:3000');
    expect(
      alignDevelopmentLoopbackOrigin(
        'http://127.0.0.1:3000',
        'http://localhost:1420'
      )
    ).toBe('http://localhost:3000');
  });

  it('does not rewrite secure or remote backend origins', () => {
    expect(
      alignDevelopmentLoopbackOrigin(
        'https://localhost:3000',
        'https://127.0.0.1:1420'
      )
    ).toBe('https://localhost:3000');
    expect(
      alignDevelopmentLoopbackOrigin(
        'https://pomi.example',
        'https://app.example'
      )
    ).toBe('https://pomi.example');
  });
});
