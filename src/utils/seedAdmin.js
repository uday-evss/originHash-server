require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize, User } = require('../models');

const seedAdmin = async () => {
  const mobile = process.env.ADMIN_MOBILE || '7816018884';
  const name = process.env.ADMIN_NAME || 'Admin';
  const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
  const password = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123';

  let admin = await User.findOne({ where: { mobile } });
  let created = false;

  if (!admin) {
    admin = User.build({
      mobile,
      countryCode: '+91',
      name,
      isBlocked: false,
      profileCompleted: true,
    });
    created = true;
  }

  admin.isAdmin = true;
  admin.isSuperAdmin = true;

  // Only set credentials the first time — never clobber a password an admin has since changed.
  if (!admin.username) admin.username = username;
  if (!admin.passwordHash) admin.passwordHash = await bcrypt.hash(password, 10);

  await admin.save();

  console.log(
    created
      ? `Seeded super-admin (${mobile}) — username: ${admin.username}`
      : `Super-admin ready (${mobile}) — username: ${admin.username}`
  );
};

module.exports = seedAdmin;

// Allow running directly: `npm run seed`
if (require.main === module) {
  sequelize
    .sync()
    .then(seedAdmin)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
