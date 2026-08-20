const errorHandler = (err, req, res, next) => {
  let status = err.statusCode || 500;
  let message = err.message || "Internal server error";

  if (err.name === "ValidationError") {
    status = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
  }

  if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue || {})[0] || "field";
    message = `That ${field} is already in use`;
  }

  if (err.name === "CastError") {
    status = 400;
    message = "Invalid identifier";
  }

  if (status >= 500) console.error(err);

  const body = { success: false, message };
  // Only forward string application codes (e.g. "EMAIL_NOT_VERIFIED"),
  // never the numeric Mongo duplicate-key code (11000) handled above.
  if (typeof err.code === "string") body.code = err.code;

  res.status(status).json(body);
};

export default errorHandler;
