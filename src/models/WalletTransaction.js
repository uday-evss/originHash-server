const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// TOPUP           Money added through Razorpay (+).
// STICKER_CHARGE  Stickers generated (− or 0 when the plan's allowance covered them all).
// PLAN_PURCHASE   A plan bought (−).
// PLAN_RENEWAL    A plan renewed automatically (−).
// REFUND          Money returned to the wallet (+), e.g. by an admin.
// ADJUSTMENT      A manual correction (±).
const TRANSACTION_TYPES = ['TOPUP', 'STICKER_CHARGE', 'PLAN_PURCHASE', 'PLAN_RENEWAL', 'REFUND', 'ADJUSTMENT'];

// The wallet's ledger: append-only, one row per balance change, with the balance after it.
// The sum of a user's rows always equals their wallet balance.
const WalletTransaction = sequelize.define(
  'WalletTransaction',
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
    type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: { isIn: [TRANSACTION_TYPES] },
    },
    // Signed: positive adds to the balance, negative takes from it.
    amountPaise: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'amount_paise',
    },
    balanceAfterPaise: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: 'balance_after_paise',
    },
    topupId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      unique: true,
      field: 'topup_id',
    },
    batchId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: 'batch_id',
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
  },
  {
    tableName: 'wallet_transactions',
    underscored: true,
    timestamps: true,
    updatedAt: false,
    indexes: [{ fields: ['user_id', 'id'] }],
  }
);

module.exports = WalletTransaction;
