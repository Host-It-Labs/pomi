import { HttpException, HttpStatus } from '@nestjs/common';

export class AuthRateLimitException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      { message: 'Too many authentication attempts. Try again later.' },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }
}
