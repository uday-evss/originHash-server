const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// One row per saved state of a user's identifying details. Rows are only ever added, never
// edited, so admins can see every name/email/address/type a user has had — and which of them
// each QR batch was generated under (qr_batches.creator_profile_version_id).
const UserProfileVersion = sequelize.define(
  'UserProfileVersion',
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
    // 1, 2, 3, … per user.
    versionNo: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: 'version_no',
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    address: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    userType: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: 'user_type',
    },
    mobile: {
      type: DataTypes.STRING(15),
      allowNull: true,
    },
    // Who made the change: 'self' (the user), 'admin' (an admin, see changedBy) or 'system'
    // (recorded automatically — existing users' details when history started, or details first
    // seen when the user generated QRs).
    source: {
      type: DataTypes.STRING(10),
      allowNull: false,
      validate: { isIn: [['self', 'admin', 'system']] },
    },
    changedBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: 'changed_by',
    },
  },
  {
    tableName: 'user_profile_versions',
    underscored: true,
    timestamps: true,
    updatedAt: false,
    indexes: [{ unique: true, fields: ['user_id', 'version_no'] }],
  }
);

module.exports = UserProfileVersion;
