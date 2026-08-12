/**
 * The slice of Node this project actually touches, declared by hand.
 *
 * `@types/node` is the obvious alternative and it is the wrong trade here. This
 * is a browser game: `tsconfig` loads the DOM lib, and half the sim calls
 * `setTimeout` expecting the DOM's `number`. Adding the Node globals puts a
 * second `setTimeout` in scope that returns a `Timeout`, and every one of those
 * call sites becomes a type error in service of a build step that only the
 * balance harness runs. The codebase already answered this question — see the
 * `declare const process` at the top of `tests/balance-grid.test.ts` — and this
 * is the same answer written once for the eval tools instead of per file.
 *
 * Kept deliberately thin. Anything added here is a promise that Node's real
 * signature matches, checked by nothing, so the less of it there is the better.
 */

declare module 'node:worker_threads' {
  export interface WorkerOptions {
    workerData?: unknown;
  }
  export class Worker {
    constructor(filename: string | URL, options?: WorkerOptions);
    postMessage(value: unknown): void;
    on(event: 'message', listener: (value: any) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'exit', listener: (code: number) => void): this;
    terminate(): Promise<number>;
    unref(): void;
  }
  export const parentPort: {
    postMessage(value: unknown): void;
    on(event: 'message', listener: (value: any) => void): void;
  } | null;
  export const workerData: unknown;
}

declare module 'node:os' {
  export function availableParallelism(): number;
  export function tmpdir(): string;
}

// `mkdtempSync`/`rmSync` are here for one caller — the test that reads the
// staleness guard, which needs a throwaway source tree to fingerprint and has
// to leave nothing behind. Nothing the game ships touches either.
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function existsSync(path: string | URL): boolean;
  export function readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean; isFile(): boolean }[];
  export function statSync(path: string): { mtimeMs: number; size: number };
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function dirname(p: string): string;
  export function resolve(...parts: string[]): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  cwd(): string;
  exit(code?: number): never;
  hrtime: { bigint(): bigint };
};
