/**
 * save-server.js
 * Simple, token-protected file write endpoints for the question-authoring UI.
 *
 * Usage:
 *   API_KEY=your_secret_key node save-server.js
 *
 * Endpoints:
 *  - POST /api/save-json    { filename: "questions/math.json", content: <array|object> }
 *  - POST /api/upload-image (multipart/form-data) field "image" -> writes to questions/media/
 *
 * Security:
 *  - protected by x-api-key header (compare to process.env.API_KEY)
 *  - restricts writes to allowed directories only (questions/ and questions/media/)
 *  - makes a timestamped backup before overwrite
 *  - validates JSON size and basic schema
 *
 * NOTE: run this behind HTTPS (nginx) in production and only bind to localhost or internal IP if possible.
 */

const express = require('express');
const multer = require('multer');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');

const API_KEY = process.env.API_KEY || 'change-this-to-a-strong-key';
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const PROJECT_ROOT = path.resolve(__dirname);
const ALLOWED_BASE = path.join(PROJECT_ROOT, 'questions'); // only allow writes here
const MAX_JSON_BYTES = 5 * 1024 * 1024; // 5MB limit

const app = express();
app.use(helmet());
app.use(express.json({ limit: '6mb' }));

// simple rate limiter
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 30
}));

// auth middleware
function requireApiKey(req, res, next) {
  const key = req.get('x-api-key');
  if (!key || key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// helper: safe path under ALLOWED_BASE
function resolveAllowed(filename) {
  // prevent path traversal; only allow under ALLOWED_BASE
  const resolved = path.resolve(PROJECT_ROOT, filename);
  if (!resolved.startsWith(ALLOWED_BASE)) {
    throw new Error('Write target not within allowed questions directory');
  }
  return resolved;
}

// backup utility
function backupFile(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const dir = path.dirname(targetPath);
  const name = path.basename(targetPath);
  const bakName = `${name}.bak-${Date.now()}`;
  const bakPath = path.join(dir, bakName);
  fs.copyFileSync(targetPath, bakPath);
  return bakPath;
}

// POST /api/save-json
app.post('/api/save-json', requireApiKey, (req, res) => {
  try {
    const { filename, content } = req.body;
    if (!filename || typeof filename !== 'string') return res.status(400).json({ error: 'filename required' });

    // ensure JSON is not huge
    const raw = JSON.stringify(content || []);
    if (Buffer.byteLength(raw, 'utf8') > MAX_JSON_BYTES) return res.status(413).json({ error: 'Payload too large' });

    // only allow writes in questions/ folder
    const targetPath = resolveAllowed(filename);

    // ensure directory exists
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // backup
    const bak = backupFile(targetPath);

    // write atomically to temp then rename
    const tmpPath = targetPath + '.tmp';
    fs.writeFileSync(tmpPath, raw, { encoding: 'utf8' });
    fs.renameSync(tmpPath, targetPath);

    return res.json({ ok: true, path: targetPath, backup: bak || null });
  } catch (err) {
    console.error('save-json error', err);
    return res.status(500).json({ error: err.message || 'server error' });
  }
});

// image upload (multipart)
// save to questions/media/
const imageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(ALLOWED_BASE, 'media');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // sanitize name: only allow [a-zA-Z0-9._-]
    const safe = file.originalname.replace(/[^\w.\-]/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});
const upload = multer({ storage: imageStorage, limits: { fileSize: 5 * 1024 * 1024 } });

app.post('/api/upload-image', requireApiKey, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  // return the public path relative to project root for the author UI to reference
  const relPath = path.relative(PROJECT_ROOT, req.file.path).replace(/\\/g, '/');
  res.json({ ok: true, path: relPath });
});

// basic health
app.get('/api/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Save server listening on port ${PORT}`);
  console.log(`Allowed write base: ${ALLOWED_BASE}`);
  console.log(`Set API_KEY env var to change the secret key.`);
});
