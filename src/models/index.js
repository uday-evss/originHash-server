const sequelize = require('../config/db');
const User = require('./User');
const Otp = require('./Otp');

module.exports = {
  sequelize,
  User,
  Otp,
};
