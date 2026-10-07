const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// SCANNED        "Scan to record": the product reached this user (supply-chain movement).
// VERIFIED       "Verify to authenticate" pressed by the FIRST user to verify this sticker. That press
//                uses the sticker up: this user gets one chance to see its image ("Yes, show the image");
//                everyone after them — this user included — gets ALREADY_VIEWED. Becomes MATCHED or
//                UNMATCHED if the user answers after seeing the image.
// PENDING        Legacy: a verification started under the old rule (before VERIFIED).
// MATCHED        The user confirmed the revealed image matches the product in hand.
// UNMATCHED      The user said the revealed image doesn't match.
// ROLLED_BACK    The user backed out (or left the screen) before answering.
// NOT_FOUND      The scanned code isn't an OriginHash sticker code.
// INVALID        The QR wasn't an OriginHash sticker at all.
// ALREADY_VIEWED The sticker's image had already been revealed once, so it wasn't shown again.
// AUTHENTIC      Legacy: verifications from before the image-match step.
const RESULTS = [
  'SCANNED',
  'VERIFIED',
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
    // Public ID shown in the app (the numeric id stays internal). Nullable in the database
    // for rows written by older servers; utils/migrateScans.js fills any gaps on start.
    uuid: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
      unique: true,
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
    // Place name for the coordinates ("Shamshabad, Telangana"), filled in shortly after the scan.
    locationName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'location_name',
    },
    // Set on the one scan that revealed this sticker's image; a sticker's image is shown only once, ever.
    // When the one chance to see the image ended without seeing it ("Not now, go back", or leaving
    // the screen). The scan stays VERIFIED; the image can no longer be revealed.
    revealClosedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'reveal_closed_at',
    },
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
