const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ImageFolder = sequelize.define(
  'ImageFolder',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      unique: true,
    },
    // Made by "Generate sample folder" (10 stock photos for trying things out). Only these can
    // be deleted, and only while no QR batch has used them.
    isSample: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_sample',
    },
  },
  {
    tableName: 'image_folders',
    underscored: true,
    timestamps: true,
  }
);

module.exports = ImageFolder;
