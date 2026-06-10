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

export class AuthError extends XcError {
  constructor(readonly status: number, message: string) {
    super(`auth failed (HTTP ${status}): ${message}`);
    this.name = 'AuthError';
  }
}
