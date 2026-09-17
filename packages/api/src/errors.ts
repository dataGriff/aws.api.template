// Domain error taxonomy. The error-mapper middleware turns these into RFC 7807
// problem+json responses; anything else becomes a 500.
export type FieldError = { field: string; message: string };

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    message?: string,
    readonly errors?: FieldError[],
  ) {
    super(message ?? title);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message?: string, errors?: FieldError[]) {
    super(400, "Bad Request", message, errors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Missing or invalid credentials") {
    super(401, "Unauthorized", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, "Not Found", message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(409, "Conflict", message);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message = "Semantic validation failed", errors?: FieldError[]) {
    super(422, "Unprocessable Entity", message, errors);
  }
}
