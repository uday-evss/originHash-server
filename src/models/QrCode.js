const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const QrCode = sequelize.define(
  'QrCode',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    batchId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: 'batch_id',
    },
    sequenceNo: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: 'sequence_no',
    },
    code: {
      type: DataTypes.STRING(60),
      allowNull: true,
      unique: true,
    },
    imageUrl: {
      type: DataTypes.STRING(500),
      allowNull: false,
      field: 'image_url',
    },
  },
  {
    tableName: 'qr_codes',
    underscored: true,
    timestamps: true,
  }
);

module.exports = QrCode;
