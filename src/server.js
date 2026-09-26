require('dotenv').config();
const app = require('./app');
const { sequelize } = require('./models');
const seedAdmin = require('./utils/seedAdmin');
const migrateScans = require('./utils/migrateScans');

const PORT = process.env.PORT || 5000;

const start = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connected.');

    await sequelize.sync(); // creates tables if they don't exist
    console.log('Tables synced.');

    await migrateScans();

    await seedAdmin();

    app.listen(PORT, () => {
      console.log(`OriginHash backend running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
