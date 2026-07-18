import { redactPersonData } from '@sudo-ai-receptionist/shared';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogger {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
}

export const createStructuredLogger = (scope: string): StructuredLogger => ({
  log(level, message, meta = {}) {
    const safeMeta = Object.fromEntries(
      Object.entries(meta).map(([key, value]) => [key, typeof value === 'string' ? redactPersonData(value) : value])
    );
    console.log(JSON.stringify({ scope, level, message: redactPersonData(message), ...safeMeta }));
  }
});

export interface MetricsSink {
  timing(name: string, valueMs: number, tags?: Record<string, string>): void;
  increment(name: string, tags?: Record<string, string>): void;
}

export const createConsoleMetrics = (): MetricsSink => ({
  timing(name, valueMs, tags) {
    console.log(JSON.stringify({ type: 'timing', name, valueMs, tags }));
  },
  increment(name, tags) {
    console.log(JSON.stringify({ type: 'count', name, tags }));
  }
});

