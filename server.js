require('dotenv').config();
require('./src/lib/flo-node');

const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { migrate } = require('./src/db/migrate');           // ← NEW
const depositRoutes = require('./src/routes/deposit');
const withdrawRoutes = require('./src/routes/withdraw');
const configRoutes = require('./src/routes/config');
const workers = require('./src/workers');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '64kb' }));

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/exchange/deposit', depositRoutes);
app.use('/api/exchange/withdraw', withdrawRoutes);
app.use('/api/exchange', configRoutes);

app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// ── Start after schema is applied ──────────────────────────────
async function boot() {
  try {
    await migrate();                                    

    if (process.env.DISABLE_WORKERS !== '1') {
      workers.startAll();
    }

    app.listen(PORT, () => {
      console.log(`Exchange backend listening on :${PORT}`);
    });
  } catch (err) {
    console.error('[boot] Fatal startup error:', err);
    process.exit(1);
  }
}

boot();
