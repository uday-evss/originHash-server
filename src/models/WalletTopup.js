const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// CREATED  A Razorpay order exists; the user may be paying (or gave up — it simply stays CREATED).
// PAID     The payment was verified with Razorpay and the amount credited to the wallet, exactly once.
const TOPUP_STATUSES = ['CREATED', 'PAID'];

// One "Add balance" attempt: a Razorpay order for a fixed amount, owned by one user.
const WalletTopup = sequelize.define(
  'WalletTopup',
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
    amountPaise: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: 'amount_paise',
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'INR',
    },
    status: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'CREATED',
      validate: { isIn: [TOPUP_STATUSES] },
    },
    razorpayOrderId: {
      type: DataTypes.STRING(40),
      allowNull: false,
      unique: true,
      field: 'razorpay_order_id',
    },
    // Unique: one Razorpay payment can never be credited twice, even to different top-ups.
    razorpayPaymentId: {
      type: DataTypes.STRING(40),
      allowNull: true,
      unique: true,
      field: 'razorpay_payment_id',
    },
    method: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    // The last failed attempt's reason (the user can retry on the same order).
    lastError: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'last_error',
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'paid_at',
    },
  },
  {
    tableName: 'wallet_topups',
    underscored: true,
    timestamps: true,
    indexes: [{ fields: ['user_id', 'created_at'] }],
  }
);

module.exports = WalletTopup;
