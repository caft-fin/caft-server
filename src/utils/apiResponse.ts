// ─────────────────────────────────────────────────────────
// CAFT Financial — Standardized API Response Helpers
// ─────────────────────────────────────────────────────────

import { Response } from 'express';

export class ApiResponse {
  static success<T>(res: Response, data: T, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  }

  static created<T>(res: Response, data: T, message = 'Created successfully') {
    return res.status(201).json({
      success: true,
      message,
      data,
    });
  }

  static paginated<T>(
    res: Response,
    data: T[],
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    },
    message = 'Success'
  ) {
    return res.status(200).json({
      success: true,
      message,
      data,
      meta,
    });
  }

  static error(res: Response, message: string, statusCode = 400, errors?: unknown) {
    return res.status(statusCode).json({
      success: false,
      message,
      errors,
    });
  }

  static unauthorized(res: Response, message = 'Unauthorized') {
    return res.status(401).json({
      success: false,
      message,
    });
  }

  static forbidden(res: Response, message = 'Forbidden') {
    return res.status(403).json({
      success: false,
      message,
    });
  }

  static notFound(res: Response, message = 'Resource not found') {
    return res.status(404).json({
      success: false,
      message,
    });
  }

  static serverError(res: Response, message = 'Internal server error') {
    return res.status(500).json({
      success: false,
      message,
    });
  }
}

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}
