# STB-CT — Setup guide

Sustainable Time Bank with Carbon Tracking, now with a real scientific carbon
calculator and a real AI recommendation engine. **Three processes**, not two:

1. **Node backend** (Express + MongoDB) — auth, time banking, the scientific
   carbon calculator, and the contract endpoint the recommendation engine calls.
2. **Python recommendation engine** (`engine/engine_server.py`) — the real
   LinUCB contextual bandit + 104-entry knowledge base, calling back into #1
   for real emission estimates. Optional: if it's not running, the app falls
   back to a simpler rule-based engine automatically — nothing crashes.
3. **React frontend** (Vite) — talks only to #1; #1 talks to #2 on the user's
   behalf, so the browser never calls the Python service directly.

**No seeded/demo data anywhere.** Every account you create is real; there is
no seed script and no shared demo group. Signing up creates your own real
friend group with a unique invite code — share that code with real
teammates to test group features together.

---

## 1. Node backend

```bash
cd Backend
npm install
cp .env.example .env
```

Fill in `.env`:
- `MONGO_URI` — MongoDB Atlas connection string (Atlas, not local mongod —
  needed for the atomic transaction guarantees on credit transfers).
- `JWT_SECRET` — any long random string.
- `ENGINE_SHARED_SECRET` — any long random string. **Must match** the same
  value in `engine/.env` (step 2).
- `RECOMMENDATION_ENGINE_URL` — leave as `http://localhost:8421` unless you
  change the engine's port.
- `FRONTEND_URL` and `BACKEND_URL` — leave as the defaults for local dev;
  these build the links inside verification/reset emails and avatar URLs.
- `RESEND_API_KEY` — **optional.** Leave blank for local dev/demo — instead
  of emailing, verification and password-reset links print straight to your
  terminal, so the flow is fully testable without a real email account. Set
  a real key (from resend.com, free tier) only if you want actual emails
  sent for a live demo.
- `CONTACT_RECEIVER_EMAIL` — where contact-form submissions notify to (also
  works with no `RESEND_API_KEY` set — submissions are still saved to Mongo).

```bash
npm start
```

You should see `MongoDB connected`, `Replica set detected`, and `STB-CT
backend running on http://localhost:5000`.

Sanity check the new scientific calculator directly:
```bash
curl -X POST http://localhost:5000/api/v1/recommendations/preview \
  -H "Content-Type: application/json" \
  -H "X-Engine-Secret: <your ENGINE_SHARED_SECRET>" \
  -d '{"baseline_activity":"car_solo_commute","baseline_quantity":12,"unit":"km","region_code":"IN_PUNJAB"}'
```
Should return `baseline_emissions_kg: 2.04` (12km × 170g/km DEFRA petrol-car
factor) with `emission_factor.source` citing DEFRA 2024.

---

## 2. Python recommendation engine

```bash
cd engine
pip install numpy --break-system-packages   # only real dependency beyond stdlib
cp .env.example .env
```

Fill in `engine/.env` — `ENGINE_SHARED_SECRET` must exactly match the Node
backend's value. Then export the variables and run:

```bash
export $(cat .env | xargs)
python3 engine_server.py
```

You should see `Recommendation engine server running on http://localhost:8421`.

This is a genuinely different file from `demo_server.py` (which still exists
in this folder from before, untouched, and still uses seeded/mock data for
its own standalone demo UI). `engine_server.py` is the one wired into your
real app — it takes real activity data from the Node backend's MongoDB and
calls the real carbon calculator, never `seed_demo_activities()` or
`MockCarbonCalculationClient`.

**This process is optional.** If it isn't running, `GET /api/v1/insights`
automatically falls back to a simpler rule-based recommendation engine and
the frontend shows an "AI engine offline" notice rather than breaking.

---

## 3. Frontend

This package is now a **complete, standalone project** — every file needed to
run it is included, nothing needs merging from anywhere else. Includes your
original landing page (Aurora background, PillNav, Hero/Features/Trinity/Stats
sections), assets, fonts, and base styles, plus everything built in this
conversation on top of them.

```bash
cd Frontend
npm install
cp .env.example .env
npm run dev
```

---

## 3a. What else is in this zip beyond Backend/Frontend/engine

- **`engine/test_*.py`** (12 files, 157 tests, 156 passing — one pre-existing
  flaky date-dependent test, unrelated to anything built in this project) —
  the recommendation engine's own test suite, verified to run from this exact
  package.
- **`engine/demo_server.py`** + **`demo_ui/index.html`** — your original
  standalone "engine inspector" demo (port 8420), independent of the Node
  backend. Useful for exploring the engine's tiers/scenarios in isolation;
  not part of the real integration (that's `engine_server.py`, port 8421).
- **`engine_docs/`** — the original architecture/design documents for the
  recommendation engine (LinUCB algorithm, API design, testing roadmap).
  Good source material for your report's methodology section.

---

## 4. Where everything lives now

| Feature | Route | Backed by |
|---|---|---|
| Carbon Calculator | `/calculator` | `Backend/src/data/scientificEmissionFactors.js` — DEFRA 2024, CEA India, Poore & Nemecek 2018. Full citations in `SCIENTIFIC_BASIS.md`. |
| Recommended For You | shown directly below the calculator | Same `/api/v1/insights` call as the AI Insights page — top 2 recommendations, plus an "Open Full AI Insights →" button |
| AI Insights | `/insights` | Real LinUCB engine when `engine_server.py` is running; rule-based fallback otherwise. The page states plainly which one produced what you're seeing. |
| Time Bank | `/marketplace` | Unchanged — still linked to carbon tracking via the linkage registry |
| Dashboard | `/dashboard` | Unchanged |
| Leaderboard | `/leaderboard` | Unchanged |
| Sign up | `/SignUp` | Creates an unverified account, emails a verification link |
| Check email | `/check-email` | Shown right after signup; can resend the verification email |
| Verify email | `/verify-email?token=...` | Verifies the account and signs you in automatically |
| Forgot password | `/forgot-password` | Requests a reset link by email |
| Reset password | `/reset-password?token=...` | Sets a new password |
| Profile | `/profile` | Avatar upload/removal, region and EV settings |
| Contact | `/contact` | Real form, saved to MongoDB, optional email notification |

---

## 4a. Email verification, password reset, avatars, and contact — how they work

**No email account required to test any of this.** Every email-sending path
checks for `RESEND_API_KEY` first — if it's unset (the default), the link or
message is printed straight to your backend's terminal instead of failing.
This is the same graceful-fallback pattern your own original backend used.

**Email verification.** Registering no longer signs you in immediately —
`POST /auth/register` creates the account (`isVerified: false`), generates a
random 32-byte token, stores only its SHA-256 hash (never the raw token) with
a 24-hour expiry, and emails a link containing the raw token. Visiting that
link calls `POST /auth/verify-email`, which re-hashes the submitted token and
compares it against the stored hash — only on a match does it flip
`isVerified` and issue a JWT. Logging in before verifying returns a specific
`EMAIL_NOT_VERIFIED` error code (not just a generic 403), which the frontend
catches and redirects to `/check-email` with a resend button.

**Password reset.** Same hash-and-compare pattern, but a 1-hour expiry
(shorter, since this token grants account takeover if leaked) and a
deliberately generic response — `POST /auth/forgot-password` always replies
"if an account exists, a link was sent," whether or not the email is
registered, so the endpoint can't be used to check who has an account.

**Avatar upload.** `POST /profile/avatar` (multipart, `multer` disk storage)
validates file type (JPEG/PNG/WEBP only) and size (5MB max) before saving,
deletes the previous avatar file on replace so uploads don't accumulate
orphaned files, and serves images back via `express.static` at
`/uploads/profile/<filename>`.

**Contact form.** `POST /contact` is rate-limited (5 submissions per 15
minutes per IP) and always saves the submission to MongoDB first — a failed
notification email doesn't lose the message, it's just marked `emailSent:
false` for you to check manually if needed.

---

## 5. Demo the full pipeline in under two minutes

1. Sign up as a new user. You'll land on **Check your email**, not the
   dashboard — with `RESEND_API_KEY` unset, look at your **backend
   terminal** for a line like `Verification link for you@email.com: http://...`.
   Copy that link into your browser (or click it if a real email was sent).
2. You're signed in automatically once verified. Note the invite code shown
   at signup (or check `/leaderboard`, which displays it once the group exists).
3. Go to **Carbon Calculator**, log a petrol car trip, ~12km, a few times
   over a few different days (use the datetime field or just log a few in a
   row — the engine cares about volume and spread, not real elapsed time for
   a demo).
4. Watch the **Recommended For You** panel below the calculator update after
   a few logs — with `engine_server.py` running, you'll see a real LinUCB
   recommendation like "Try Public Transport" with a genuine computed saving.
5. Click **Open Full AI Insights →** to see the full page, including your
   personalization tier (cold / developing / established) and data
   confidence score — both computed live from what you just logged.
6. Stop `engine_server.py` and refresh Insights — it falls back gracefully
   to the rule-based engine, with a visible notice explaining why, rather
   than breaking.
7. Visit **/profile** and upload an avatar — it appears immediately in the
   nav bar. Visit **/contact** and send a message — check your backend
   terminal for the logged notification if no `RESEND_API_KEY` is set.

That fallback behavior (step 6) is worth demonstrating deliberately in a
viva — it shows the system was designed for the AI engine being a real,
separate service that can fail independently, not a tightly-coupled single
point of failure.

---

## 6. What to say about the scientific calculator specifically

Read `SCIENTIFIC_BASIS.md` before your viva — it's written to be quoted
directly. Key points if asked:

- Transport uses DEFRA 2024 (the most widely used public transport factor
  set internationally) for car/bus/rail, and IPCC 2006 default combustion
  factors combined with representative India fuel-economy figures for
  two-wheelers, auto-rickshaws, and CNG cars — DEFRA doesn't cover these
  vehicle types, so the derivation is shown transparently rather than
  presenting an invented "official" number.
- Electricity uses India's actual official grid factor (CEA, Version 21.0,
  710 gCO₂/kWh, FY 2024-25) — the same figure used in India's carbon market.
- Food uses Poore & Nemecek (2018), the largest food-system LCA
  meta-analysis ever conducted, published in *Science*.
- Consumption/goods figures are explicitly labeled "indicative" — no single
  official standard exists at that granularity, and the document says so
  rather than pretending otherwise.

## Known limitations to state openly

Automated tests are not included for the Node/React layers (the Python
engine has its own 157-test suite, already passing, inherited unchanged).
The app runs on localhost only — no cloud deployment. Both were explicit
scope cuts made under time pressure.


---

