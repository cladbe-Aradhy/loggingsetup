export {};

declare global {
  interface Error {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    cause?: unknown;
    authorization?: unknown;
  }

  namespace NodeJS {
    interface Process {
      moduleLoadList?: string[];
    }
  }
}
