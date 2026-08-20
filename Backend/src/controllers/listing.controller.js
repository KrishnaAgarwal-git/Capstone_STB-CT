import ServiceListing from "../models/ServiceListing.js";
import { asyncHandler, badRequest, notFound, forbidden, ok, created } from "../utils/ApiError.js";
import { SERVICE_CATEGORY_KEYS } from "../config/constants.js";

export const createListing = asyncHandler(async (req, res) => {
  const { title, description, category, estimatedHours } = req.body;

  if (!title || !category) throw badRequest("Title and category are required");
  if (!SERVICE_CATEGORY_KEYS.includes(category)) throw badRequest("Unknown service category");

  const groupId = req.user.groups?.[0];
  if (!groupId) throw badRequest("Join a friend group before posting a service");

  const listing = await ServiceListing.create({
    title,
    description: description || "",
    category,
    provider: req.user._id,
    group: groupId,
    estimatedHours: Number(estimatedHours) || 1,
  });

  created(res, listing, "Service posted");
});

export const browseListings = asyncHandler(async (req, res) => {
  const { category, mine } = req.query;
  const groupIds = req.user.groups || [];

  const q = { group: { $in: groupIds }, isActive: true };
  if (category) q.category = category;
  if (mine === "true") q.provider = req.user._id;
  else q.provider = { $ne: req.user._id }; // marketplace hides your own listings

  const listings = await ServiceListing.find(q)
    .populate("provider", "firstName lastName points badges servicesProvided ratingSum ratingCount")
    .sort({ createdAt: -1 })
    .limit(100);

  ok(res, listings);
});

export const deleteListing = asyncHandler(async (req, res) => {
  const listing = await ServiceListing.findById(req.params.id);
  if (!listing) throw notFound("Listing not found");
  if (String(listing.provider) !== String(req.user._id))
    throw forbidden("You can only remove your own listings");

  listing.isActive = false;
  await listing.save();
  ok(res, null, "Listing removed");
});
