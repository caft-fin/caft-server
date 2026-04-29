// ─────────────────────────────────────────────────────────
// CAFT Financial — Global Error Handler Middleware
// ─────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/apiResponse';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('❌ Error:', err.message);

  // Zod validation errors
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));

    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: formattedErrors,
    });
    return;
  }

  // Custom application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  // Prisma known errors
  if (err.constructor.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as any;
    switch (prismaErr.code) {
      case 'P2002':
        res.status(409).json({
          success: false,
          message: `A record with this ${prismaErr.meta?.target?.join(', ')} already exists`,
        });
        return;
      case 'P2025':
        res.status(404).json({
          success: false,
          message: 'Record not found',
        });
        return;
      default:
        res.status(400).json({
          success: false,
          message: 'Database error',
        });
        return;
    }
  }

  // Default server error
  const statusCode = (err as any).statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message || 'Internal server error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}
