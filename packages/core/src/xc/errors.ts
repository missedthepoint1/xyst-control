export class XcError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'XcError';
  }
}

export class LivescopeError extends XcError {
  constructor(readonly status: number, message: string) {
    super(`livescope-status ${status}: ${message}`);
    this.name = 'LivescopeError';
  }
}
