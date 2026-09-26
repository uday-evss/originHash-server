const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ImageAsset = sequelize.define(
  'ImageAsset',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    // Gap-free image number (1, 2, 3, …) in upload order; the id above can skip numbers.
    // NULL for images in generated sample folders, which can be deleted.
    serialNo: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      unique: true,
      field: 'serial_no',
    },
    folderId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: 'folder_id',
    },
    fileName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'file_name',
    },
    url: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    width: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    height: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    sizeBytes: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: 'size_bytes',
    },
    mimeType: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: 'mime_type',
    },
    fileHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: 'file_hash',
    },
    isBlocked: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_blocked',
    },
  },
  {
    tableName: 'image_assets',
    underscored: true,
    timestamps: true,
    indexes: [{ fields: ['folder_id', 'file_hash'], unique: true }],
  }
);

module.exports = ImageAsset;
