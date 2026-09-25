const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const imageStockRoutes = require('./routes/imageStockRoutes');
const qrStickerRoutes = require('./routes/qrStickerRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const scanRoutes = require('./routes/scanRoutes');

const app = express();

// Behind Render's (or any) reverse proxy, so req.ip / req.secure reflect the client, not the proxy hop.
app.set('trust proxy', 1);

// CORS_ORIGIN: comma-separated allowlist (e.g. your Vercel domain). Unset/empty allows all origins,
// which is fine for local dev but should be locked down once a frontend URL exists in production.
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors(
    allowedOrigins.length
      ? {
          origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
              callback(null, true);
            } else {
              callback(new Error('Not allowed by CORS'));
            }
          },
        }
      : undefined
  )
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/image-stock', imageStockRoutes);
app.use('/api/qr-stickers', qrStickerRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/scans', scanRoutes);

// 404
app.use((req, res) => res.status(404).json({ message: 'Route not found.' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Something went wrong.' });
});

module.exports = app;
