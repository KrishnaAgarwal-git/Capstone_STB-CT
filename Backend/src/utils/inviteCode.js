// Same alphabet as the ride-verification codes: no ambiguous chars (0/O, 1/I).
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const generateInviteCode = (length = 6) => {
  let out = "";
  for (let i = 0; i < length; i++) out += CHARS[Math.floor(Math.random() * CHARS.length)];
  return out;
};
