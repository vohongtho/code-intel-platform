export const ErrorCodes = {
  UNAUTHORIZED: 'CI-1000',
  FORBIDDEN: 'CI-1001',
  NOT_FOUND: 'CI-1002',
  ANALYSIS_IN_PROGRESS: 'CI-1003',
  INDEX_NOT_FOUND: 'CI-1004',
  DB_CORRUPTED: 'CI-1042',
  RATE_LIMIT_EXCEEDED: 'CI-1100',
  INVALID_REQUEST: 'CI-1200',
  INTERNAL_ERROR: 'CI-5000',
} as const;

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public hint: string,
    public statusCode: number = 500,
    public docs?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
