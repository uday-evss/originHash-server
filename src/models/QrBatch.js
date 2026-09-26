const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const QrBatch = sequelize.define(
  'QrBatch',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    producer: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    productName: {
      type: DataTypes.STRING(150),
      allowNull: false,
      field: 'product_name',
    },
    variantSize: {
      type: DataTypes.STRING(150),
      allowNull: true,
      field: 'variant_size',
    },
    batchNo: {
      type: DataTypes.STRING(80),
      allowNull: false,
      field: 'batch_no',
    },
    splitType: {
      type: DataTypes.ENUM('vertical-50-50', 'horizontal-50-50'),
      allowNull: false,
      defaultValue: 'vertical-50-50',
      field: 'split_type',
    },
    // Paper the sticker PDF is laid out on. NULL on batches made before this existed (= A4).
    pageSize: {
      type: DataTypes.STRING(2),
      allowNull: false,
      defaultValue: 'A4',
      validate: { isIn: [['A4', 'A3']] },
      field: 'page_size',
    },
    numberOfQrs: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: 'number_of_qrs',
    },
    folderId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: 'folder_id',
    },
    // The user who generated the batch; they can see the full journey of its stickers.
    createdBy: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: 'created_by',
    },
  },
  {
    tableName: 'qr_batches',
    underscored: true,
    timestamps: true,
  }
);

module.exports = QrBatch;
