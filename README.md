# Dukaanflow
Node + Express + MongoDB app: auth (JWT/bcrypt), hiring, tasks, voice-driven shop ledger, notifications, admin.

## Run
1. Install Node 18+ and MongoDB (or a free MongoDB Atlas URI).
2. `npm install`
3. `cp .env.example .env` and set `MONGO_URI`, `JWT_SECRET`. Sign up with `ADMIN_PHONE` to get the admin role.
4. `npm start` → open http://localhost:3000

Demo data: `npm run demo` starts the server and loads 12 sample workers (skill, ₹/day, ₹/hour, experience, city, languages, rating, jobs), a shop owner, customers, stock, orders, tasks, invitations and alerts. Log in as owner `9876500001` or any worker `9000000001`-`9000000012`, password `demo123`. Safe to run again.

Roles: **Shop Owner** (hire, tasks, shop), **Worker** (profile, invitations, tasks), **Admin** (users).
Task flow: Pending → Assigned → Accepted → In Progress → Completed → Verified (or Rejected).
Voice uses the browser speech engine (Chrome/Edge); typing works everywhere.

## Not yet built
Password-reset email, charts, proof upload, written reviews (star rating on verify is built), reports, edit-product UI.

## Users / Community
Everyone who signs up or logs in is a row in the existing `User` collection - nothing is added by hand.
- **Community tab** (all roles): member cards with picture, name, @username, role, online status, joined date; search by name/username; filter by type and "online now"; paging.
- **Profiles**: click a name to open it. "My profile" lets anyone edit name, username, email, city, about me and picture (any role).
- **Signup** has two new optional fields (username, email). A blank username is made from the name (e.g. `rameshkumar`).
  Old accounts get a username automatically the first time the server starts (`backfillUsernames` in `backend/users.js`).
- **Online status**: the page pings `/api/presence` every 30s; logout marks offline immediately; no ping for 90s = offline.
- **Admin > Users**: totals (all / active / suspended / online / owners / workers), search + filter, suspend/activate, verify.
- **Privacy**: password hash, mobile number (the login ID) and tokens are never in the community API. Email is hidden unless the person ticks "Show my email" (admins always see it).
  Pictures are shrunk to 160px in the browser and stored in the same user record (max ~45 KB, JPG/PNG/WebP only).

Files: `backend/users.js` (all new server code), small edits in `backend/server.js` and `backend/models.js`, UI in `frontend/index.html`.
