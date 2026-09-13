const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Otp = sequelize.define(
  'Otp',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    mobile: {
      type: DataTypes.STRING(15),
      allowNull: false,
    },
    otpCode: {
      type: DataTypes.STRING(10),
      allowNull: false,
      field: 'otp_code',
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'expires_at',
    },
    isUsed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_used',
    },
  },
  {
    tableName: 'otps',
    underscored: true,
    timestamps: true,
    updatedAt: false,
  }
);

module.exports = Otp;
