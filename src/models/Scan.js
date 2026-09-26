const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// SCANNED        "Scan to record": the product reached this user (supply-chain movement).
// PENDING        "Verify to authenticate" started; waiting for the user to reveal the image and answer.
// MATCHED        The user confirmed the revealed image matches the product in hand.
// UNMATCHED      The user said the revealed image doesn't match.
// ROLLED_BACK    The user backed out (or left the screen) before answering.
// NOT_FOUND      The scanned code isn't an OriginHash sticker code.
// INVALID        The QR wasn't an OriginHash sticker at all.
// ALREADY_VIEWED The sticker's image had already been revealed once, so it wasn't shown again.
// AUTHENTIC      Legacy: verifications from before the image-match step.
const RESULTS = [
  'SCANNED',
  'PENDING',
  'MATCHED',
  'UNMATCHED',
  'ROLLED_BACK',
  'NOT_FOUND',
  'INVALID',
  'ALREADY_VIEWED',
  'AUTHENTIC',
];

// One row per scan a user makes in the app: "record" logs that a product reached them,
// "verify" checks a product is genuine by comparing its once-only image.
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
    // Null when the scanned code matched no sticker.
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
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: { isIn: [RESULTS] },
    },
    latitude: {
      type: DataTypes.DECIMAL(9, 6),
      allowNull: true,
    },
    longitude: {
      type: DataTypes.DECIMAL(9, 6),
      allowNull: true,
    },
    // Set on the one scan that revealed this sticker's image; a sticker's image is shown only once, ever.
    imageRevealedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'image_revealed_at',
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
