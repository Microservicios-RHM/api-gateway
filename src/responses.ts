import type { Response } from 'express';

export function sendErrorResponse(
  response: Response,
  status: number,
  message: string,
  code: string,
  path: string,
): void {
  if (response.headersSent) return;
  response.status(status).json({
    success: false,
    message,
    data: null,
    error: {
      code,
      status,
      path,
      timestamp: new Date().toISOString(),
    },
  });
}
