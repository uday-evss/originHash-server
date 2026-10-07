const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// One prepaid balance per user, in paise (₹1 = 100 paise) so money is never a float.
// Only ever changed inside a transaction that locks this row and writes a WalletTransaction.
const Wallet = sequelize.define(
  'Wallet',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      unique: true,
      field: 'user_id',
    },
    balancePaise: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      field: 'balance_paise',
    },
  },
  {
    tableName: 'wallets',
    underscored: true,
    timestamps: true,
  }
);

module.exports = Wallet;
