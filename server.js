const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'website')));

const DOWNLOAD_URL = 'https://github.com/ivandkriddd/velocity/releases/download/v1.0.0/Velocity.Setup.1.0.0.exe';
const JWT_SECRET = process.env.JWT_SECRET || 'velocity-sync-secret-change-in-production';
const FIRESTORE_COLLECTION = 'users';

let db = null;

try {
  const admin = require('firebase-admin');
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    console.log('Firestore connected');
  } else {
    console.log('FIREBASE_SERVICE_ACCOUNT not set — sync API disabled');
  }
} catch (e) {
  console.log('Firebase not available — sync API disabled:', e.message);
}

// Auth middleware
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

// -- Auth Routes --

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password || password.length < 6) return res.status(400).json({ error: 'Email and password (min 6 chars) required' });
    if (!db) return res.status(503).json({ error: 'Sync server unavailable' });

    const usersRef = db.collection(FIRESTORE_COLLECTION);
    const existing = await usersRef.where('email', '==', email.toLowerCase()).get();
    if (!existing.empty) return res.status(409).json({ error: 'Email already registered' });

    const salt = crypto.randomBytes(32).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');

    const doc = await usersRef.add({ email: email.toLowerCase(), salt, hash, createdAt: new Date().toISOString() });
    const token = jwt.sign({ uid: doc.id, email: email.toLowerCase() }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, uid: doc.id, email: email.toLowerCase() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (!db) return res.status(503).json({ error: 'Sync server unavailable' });

    const snapshot = await db.collection(FIRESTORE_COLLECTION).where('email', '==', email.toLowerCase()).get();
    if (snapshot.empty) return res.status(401).json({ error: 'Invalid email or password' });

    const doc = snapshot.docs[0];
    const data = doc.data();
    const hash = crypto.pbkdf2Sync(password, data.salt, 100000, 64, 'sha512').toString('hex');
    if (hash !== data.hash) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ uid: doc.id, email: email.toLowerCase() }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, uid: doc.id, email: email.toLowerCase() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/verify', authenticate, (req, res) => {
  res.json({ valid: true, uid: req.user.uid, email: req.user.email });
});

// -- Sync Routes --

app.post('/api/sync/upload', authenticate, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Sync server unavailable' });
    const { bookmarks, history, settings, passwords } = req.body;
    const update = {};
    if (bookmarks !== undefined) update.bookmarks = bookmarks;
    if (history !== undefined) update.history = history;
    if (settings !== undefined) update.settings = settings;
    if (passwords !== undefined) update.passwords = passwords;
    update.lastSync = new Date().toISOString();
    await db.collection(FIRESTORE_COLLECTION).doc(req.user.uid).update(update);
    res.json({ success: true, lastSync: update.lastSync });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sync/download', authenticate, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Sync server unavailable' });
    const doc = await db.collection(FIRESTORE_COLLECTION).doc(req.user.uid).get();
    if (!doc.exists) return res.json({ data: null });
    const { salt, hash, email, createdAt, ...syncData } = doc.data();
    res.json({ data: syncData });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -- Download Routes --

app.get('/download', (req, res) => res.redirect(302, DOWNLOAD_URL));
app.get('/download/latest', (req, res) => res.redirect(302, DOWNLOAD_URL));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Velocity server running on port ' + PORT));
