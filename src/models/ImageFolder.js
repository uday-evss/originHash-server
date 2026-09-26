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
    // be deleted.
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
    // Deleting a folder only sets deleted_at: QR batches keep pointing at it (and at its name),
    // while every normal query leaves it out. Pass `paranoid: false` to include deleted folders.
    paranoid: true,
  }
);

module.exports = ImageFolder;
