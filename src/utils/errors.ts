export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export class AuthError extends AppError {
  constructor(message: string) {
    super(401, message, 'AUTH_ERROR');
  }
}
export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, message, 'FORBIDDEN');
  }
}
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message, 'NOT_FOUND');
  }
}
export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, 'VALIDATION_ERROR');
  }
}
export class RateLimitError extends AppError {
  constructor(public retryAfter = 60) {
    super(429, 'Rate limit exceeded', 'RATE_LIMIT');
  }
}

export class BudgetExceededError extends AppError {
  constructor(public scope: 'org' | 'team' | 'agent') {
    super(429, 'Budget exceeded', 'BUDGET_EXCEEDED');
  }
}

export class ProviderError extends AppError {
  constructor(
    public readonly latencyMs: number,
    public readonly isTimeout = false,
    public readonly providerStatus?: number,
    public readonly providerMessage?: string
  ) {
    super(
      providerStatus === 429 ? 429 : 502,
      providerStatus === 429 ? 'Provider rate limit exceeded' : 'Provider request failed',
      providerStatus === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_ERROR'
    );
  }
}
