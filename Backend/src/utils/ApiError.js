export class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

export const badRequest = (msg) => new ApiError(400, msg);
export const unauthorized = (msg = "Not authorised") => new ApiError(401, msg);
export const forbidden = (msg = "Forbidden") => new ApiError(403, msg);
export const notFound = (msg = "Not found") => new ApiError(404, msg);
export const conflict = (msg) => new ApiError(409, msg);

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const ok = (res, data, message = "Success") =>
  res.json({ success: true, message, data });

export const created = (res, data, message = "Created") =>
  res.status(201).json({ success: true, message, data });
