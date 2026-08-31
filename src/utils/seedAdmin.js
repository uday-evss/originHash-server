require('dotenv').config();
const { sequelize, User } = require('../models');

const seedAdmin = async () => {
  const mobile = process.env.ADMIN_MOBILE || '7816018884';
  const name = process.env.ADMIN_NAME || 'Admin';

  const [admin, created] = await User.findOrCreate({
    where: { mobile },
    defaults: {
      mobile,
      countryCode: '+91',
      name,
      isAdmin: true,
      isBlocked: false,
      profileCompleted: true,
    },
  });

  if (!admin.isAdmin) {
    admin.isAdmin = true;
    await admin.save();
  }

  console.log(
    created ? `Seeded admin user (${mobile}).` : `Admin user already exists (${mobile}).`
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
