import { Logger } from '@nestjs/common';

export class PomiLogger extends Logger {
  info(message: any, context?: string) {
    const instance =
      (this as any).localInstance || (Logger as any).staticInstance;
    if (instance && typeof (instance as any).info === 'function') {
      (instance as any).info(message, context || this.context);
    } else {
      super.log(message, context || this.context);
    }
  }
}
