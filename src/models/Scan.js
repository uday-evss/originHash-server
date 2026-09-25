const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// One row per scan a user completes in the app: "record" logs that a product reached them
// (the supply-chain movement), "verify" checks a product's QR is genuine.
const Scan = sequelize.define(
  'Scan',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: 'user_id',
    },
    // Null when the scanned code matched no sticker (a failed verification).
    qrCodeId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: 'qr_code_id',
    },
    // The code as scanned, kept even when it matched nothing.
    code: {
      type: DataTypes.STRING(60),
      allowNull: true,
    },
    action: {
      type: DataTypes.ENUM('record', 'verify'),
      allowNull: false,
    },
    result: {
      type: DataTypes.ENUM('recorded', 'authentic', 'not_found', 'invalid'),
      allowNull: false,
    },
    latitude: {
      type: DataTypes.DECIMAL(9, 6),
      allowNull: true,
    },
    longitude: {
      type: DataTypes.DECIMAL(9, 6),
      allowNull: true,
    },
  },
  {
    tableName: 'scans',
    underscored: true,
    timestamps: true,
    updatedAt: false,
  }
);

module.exports = Scan;
