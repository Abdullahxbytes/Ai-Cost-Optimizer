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
