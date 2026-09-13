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
  },
  {
    tableName: 'image_folders',
    underscored: true,
    timestamps: true,
  }
);

module.exports = ImageFolder;
