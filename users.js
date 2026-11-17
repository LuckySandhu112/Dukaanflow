// =====================================================================
//  Users / Community feature
//  Works on the SAME "User" collection used by login & signup.
//  server.js hands us its own helpers (auth, W, bad, str) so we reuse
//  your existing login check, error handling and input cleaning.
// =====================================================================
const mongoose = require('mongoose');
const M = require('./models');

// ---------- Settings ----------
const ONLINE_WINDOW_MS = 90 * 1000;      // "online" = heartbeat received in the last 90 seconds
const USERNAME_RE = /^[a-z0-9_]{3,20}$/; // letters, numbers, underscore
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_AVATAR_CHARS = 60000;          // ~45 KB image. The browser shrinks pictures to ~160px first.

// ---------- Small helpers ----------
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A user counts as online only if they are flagged online AND we heard from them recently.
// (If someone just closes the tab without logging out, they flip to offline by themselves.)
const isOnline = u => !!u.isOnline && !!u.lastSeen && Date.now() - u.lastSeen.getTime() < ONLINE_WINDOW_MS;

const avatarUrl = u => (u.avatarAt ? `/api/users/${u.id}/avatar?v=${u.avatarAt.getTime()}` : null);

// ---------- Presence (online / offline) ----------
const markOnline = id => M.User.updateOne({ _id: id }, { isOnline: true, lastSeen: new Date() }, { timestamps: false });
const markOffline = id => M.User.updateOne({ _id: id }, { isOnline: false, lastSeen: new Date() }, { timestamps: false });

// ---------- Username / email cleaning ----------
function cleanUsername(v, bad) {
  const name = String(v ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!USERNAME_RE.test(name)) bad('Username must be 3-20 characters: letters, numbers or _');
  return name;
}
// Returns a lowercase email, or undefined if the person left it empty (email is optional).
function cleanEmail(v, bad) {
  const email = String(v ?? '').trim().toLowerCase();
  if (!email) return undefined;
  if (email.length > 100 || !EMAIL_RE.test(email)) bad('Enter a valid email address');
  return email;
}

// Make a free username from someone's name, e.g. "Ramesh Kumar" -> "rameshkumar" (or "rameshkumar482").
async function makeUsername(name) {
  let base = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14);
  if (base.length < 3) base = (base + 'user').slice(0, 8);
  if (!(await M.User.exists({ username: base }))) return base;
  for (let i = 0; i < 30; i++) {
    const candidate = base + Math.floor(100 + Math.random() * 9900);
    if (!(await M.User.exists({ username: candidate }))) return candidate;
  }
  return base + Date.now().toString(36).slice(-5);
}

// Runs at server start: gives a username to every OLD account that does not have one yet.
// Safe to run again and again - it only touches accounts that are missing a username.
async function backfillUsernames() {
  const old = await M.User.find({ username: { $exists: false } }).select('name');
  for (const u of old) {
    await M.User.updateOne({ _id: u._id }, { username: await makeUsername(u.name) }, { timestamps: false });
  }
  if (old.length) console.log(`Community: created usernames for ${old.length} existing account(s)`);
}

// ---------- What each kind of viewer is allowed to see ----------
// NOTE: none of these ever include hash, phone (the login ID), tokens or the avatar bytes.

// Public card shown in the Users list and on a profile page.
function memberView(u, viewer) {
  const maySeeEmail = u.showEmail || (viewer && (viewer.role === 'admin' || viewer.id === u.id));
  return {
    id: u.id, name: u.name, username: u.username, role: u.role,
    city: u.city, bio: u.bio, skill: u.skill, verified: u.verified,
    avatarUrl: avatarUrl(u), joined: u.createdAt,
    online: isOnline(u), lastSeen: u.lastSeen || null,
    email: maySeeEmail && u.email ? u.email : null,
  };
}

// Extra worker details on a profile page (only worker accounts have these).
function workerExtras(u) {
  if (u.role !== 'worker') return {};
  return { worker: { exp: u.exp, rating: u.rating, jobs: u.jobs, langs: u.langs, avail: u.avail } };
}

// Added to the logged-in person's OWN data (login / signup / me responses).
const selfExtras = u => ({ username: u.username, email: u.email || '', showEmail: !!u.showEmail, avatarUrl: avatarUrl(u), joined: u.createdAt });

// For the admin table.
const adminView = u => ({ ...memberView(u, { role: 'admin' }), phone: u.phone, active: u.active, verified: u.verified, wage: u.wage });

// ---------- Routes ----------
function register(app, { auth, W, bad, str }) {

  // GET /api/users?q=ram&role=worker&status=online&page=1
  // Any logged-in person can browse the community. Suspended accounts are hidden.
  app.get('/api/users', auth(), W(async (q, s) => {
    const filter = { active: true };
    const search = str(q.query.q, 50).replace(/^@/, '');
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: rx }, { username: rx }];
    }
    if (['owner', 'worker', 'admin'].includes(q.query.role)) filter.role = q.query.role;
    const onlineQuery = { isOnline: true, lastSeen: { $gte: new Date(Date.now() - ONLINE_WINDOW_MS) } };
    if (q.query.status === 'online') Object.assign(filter, onlineQuery);

    const limit = Math.min(Math.max(parseInt(q.query.limit) || 20, 1), 50);
    const page = Math.max(parseInt(q.query.page) || 1, 1);
    const [total, onlineNow, users] = await Promise.all([
      M.User.countDocuments(filter),
      M.User.countDocuments({ active: true, ...onlineQuery }),
      M.User.find(filter)
        // Whitelist: only these fields are even read from the database.
        .select('name username email showEmail role city bio skill verified createdAt avatarAt isOnline lastSeen')
        .sort('-createdAt').skip((page - 1) * limit).limit(limit),
    ]);
    s.json({ total, onlineNow, page, pages: Math.max(1, Math.ceil(total / limit)), users: users.map(u => memberView(u, q.user)) });
  }));

  // PUT /api/users/me  - the logged-in person edits their own profile (any role).
  // Only fields that are sent are changed.
  app.put('/api/users/me', auth(), W(async (q, s) => {
    const b = q.body, u = q.user;
    if ('name' in b) {
      const name = str(b.name);
      if (name.length < 2) bad('Enter your name');
      u.name = name;
    }
    if ('username' in b) u.username = cleanUsername(b.username, bad);
    if ('email' in b) u.email = cleanEmail(b.email, bad); // undefined removes it
    if ('showEmail' in b) u.showEmail = !!b.showEmail;
    if ('city' in b) u.city = str(b.city, 40);
    if ('bio' in b) u.bio = str(b.bio, 200);
    if ('avatar' in b) {
      if (!b.avatar) {                       // empty = remove picture
        u.set('avatar', undefined);
        u.set('avatarAt', undefined);
      } else {
        if (typeof b.avatar !== 'string' || b.avatar.length > MAX_AVATAR_CHARS || !AVATAR_RE.test(b.avatar)) bad('Picture must be a small JPG, PNG or WebP image');
        u.avatar = b.avatar;
        u.avatarAt = new Date();
      }
    }
    await u.save();
    s.json({ ...memberView(u, u), ...selfExtras(u) });
  }));

  // GET /api/users/:id/avatar  - the picture itself (public, like any profile photo).
  // It is a normal URL so <img src="..."> works. Suspended users' pictures are hidden.
  app.get('/api/users/:id/avatar', W(async (q, s) => {
    if (!mongoose.isValidObjectId(q.params.id)) bad('Not found', 404);
    const u = await M.User.findOne({ _id: q.params.id, active: true }).select('+avatar avatarAt');
    if (!u || !u.avatar) bad('Not found', 404);
    const [, mime, data] = u.avatar.match(/^data:(image\/[a-z]+);base64,(.*)$/);
    s.set({ 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    s.send(Buffer.from(data, 'base64'));
  }));

  // GET /api/users/:id  - one person's public profile
  app.get('/api/users/:id', auth(), W(async (q, s) => {
    if (!mongoose.isValidObjectId(q.params.id)) bad('User not found', 404);
    const u = await M.User.findById(q.params.id);
    // Only admins may open a suspended account's profile.
    if (!u || (!u.active && q.user.role !== 'admin')) bad('User not found', 404);
    s.json({ ...memberView(u, q.user), ...workerExtras(u), active: u.active });
  }));

  // POST /api/presence  - "I'm still here" signal. The website sends it every 30 seconds while someone is logged in.
  app.post('/api/presence', auth(), W(async (q, s) => {
    await markOnline(q.user.id);
    s.json({ ok: true });
  }));
}

module.exports = { register, markOnline, markOffline, makeUsername, backfillUsernames, cleanUsername, cleanEmail, selfExtras, adminView };
