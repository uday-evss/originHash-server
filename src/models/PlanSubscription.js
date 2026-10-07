const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// ACTIVE  The plan covers stickers now. At most one per user (enforced under the wallet lock).
// PAUSED  Renewal failed for lack of balance; stickers are Pay As You Go until the user resumes.
// ENDED   Finished: renewed into a new row (RENEWED), cancelled (CANCELLED) or replaced (REPLACED).
const PLAN_STATUSES = ['ACTIVE', 'PAUSED', 'ENDED'];

// One paid period of a plan: a month, or a year bought upfront. The allowance resets every month
// inside the period (cycleStart → cycleEnd), and unused codes expire. Each renewal is a new row,
// so the table is the user's plan history.
const PlanSubscription = sequelize.define(
  'PlanSubscription',
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'user_id' },
    planType: { type: DataTypes.STRING(20), allowNull: false, field: 'plan_type' },
    billingCycle: { type: DataTypes.STRING(10), allowNull: false, field: 'billing_cycle' },
    monthlyQuota: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'monthly_quota' },
    // What this period cost, and the price per sticker beyond the allowance — fixed at purchase.
    pricePaise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'price_paise' },
    overagePricePaise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'overage_price_paise' },
    status: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'ACTIVE',
      validate: { isIn: [PLAN_STATUSES] },
    },
    autoRenew: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'auto_renew' },
    periodStart: { type: DataTypes.DATE, allowNull: false, field: 'period_start' },
    periodEnd: { type: DataTypes.DATE, allowNull: false, field: 'period_end' },
    cycleStart: { type: DataTypes.DATE, allowNull: false, field: 'cycle_start' },
    cycleEnd: { type: DataTypes.DATE, allowNull: false, field: 'cycle_end' },
    cycleUsed: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0, field: 'cycle_used' },
    // A change chosen during this period; it takes effect at the next renewal.
    nextPlanType: { type: DataTypes.STRING(20), allowNull: true, field: 'next_plan_type' },
    nextBillingCycle: { type: DataTypes.STRING(10), allowNull: true, field: 'next_billing_cycle' },
    nextMonthlyQuota: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: 'next_monthly_quota' },
    endedReason: { type: DataTypes.STRING(20), allowNull: true, field: 'ended_reason' },
    endedAt: { type: DataTypes.DATE, allowNull: true, field: 'ended_at' },
  },
  {
    tableName: 'plan_subscriptions',
    underscored: true,
    timestamps: true,
    indexes: [{ fields: ['user_id', 'status'] }, { fields: ['status', 'cycle_end'] }],
  }
);

module.exports = PlanSubscription;
