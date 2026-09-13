const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const User = sequelize.define(
  'User',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    mobile: {
      type: DataTypes.STRING(15),
      allowNull: true,
      unique: true,
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true,
    },
    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'password_hash',
    },
    countryCode: {
      type: DataTypes.STRING(5),
      allowNull: false,
      defaultValue: '+91',
      field: 'country_code',
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    photoUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'photo_url',
    },
    userType: {
      type: DataTypes.ENUM('farmer', 'retailer', 'distributor', 'supplier', 'consumer'),
      allowNull: true,
      field: 'user_type',
    },
    address: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    isAdmin: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_admin',
    },
    isSuperAdmin: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_super_admin',
    },
    isBlocked: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_blocked',
    },
    profileCompleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'profile_completed',
    },
    scansCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: 'scans_count',
    },
  },
  {
    tableName: 'users',
    underscored: true,
    timestamps: true,
  }
);

module.exports = User;
