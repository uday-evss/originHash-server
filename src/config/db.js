const { Sequelize } = require('sequelize');
require('dotenv').config();

// Managed MySQL providers (PlanetScale, Aiven, Railway, etc.) generally require
// TLS — set DB_SSL=true to enable it without touching local dev.
const dialectOptions =
  String(process.env.DB_SSL).toLowerCase() === 'true'
    ? { ssl: { rejectUnauthorized: true } }
    : {};

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    dialectOptions,
    logging: false,
  }
);

module.exports = sequelize;
