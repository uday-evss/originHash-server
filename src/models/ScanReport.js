const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// A user's report about a scanned product — sent with an "Unmatched" answer, or from an
// "Already verified" result. The photo and note are both optional.
const ScanReport = sequelize.define(
  'ScanReport',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    scanId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      unique: true,
      field: 'scan_id',
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    photoUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'photo_url',
    },
  },
  {
    tableName: 'scan_reports',
    underscored: true,
    timestamps: true,
    updatedAt: false,
  }
);

module.exports = ScanReport;
