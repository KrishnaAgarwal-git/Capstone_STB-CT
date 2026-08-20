import ContactSubmission from "../models/ContactSubmission.js";
import { sendContactNotification } from "../services/email.service.js";
import { asyncHandler, badRequest, created } from "../utils/ApiError.js";

export const submitContact = asyncHandler(async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !message) throw badRequest("Name, email, and message are required");
  if (message.length > 5000) throw badRequest("Message is too long");

  const submission = await ContactSubmission.create({ name, email, subject, message });

  try {
    const result = await sendContactNotification({ name, email, subject, message });
    submission.emailSent = result.sent;
    await submission.save();
  } catch {
    // Submission is already saved - a failed notification email shouldn't
    // fail the whole request, the message isn't lost.
  }

  created(res, null, "Thanks for reaching out - we'll get back to you soon");
});
