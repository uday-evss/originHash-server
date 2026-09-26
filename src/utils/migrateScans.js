const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

const columnType = async (column) => {
  const [row] = await sequelize.query(
    `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scans' AND COLUMN_NAME = :column`,
    { replacements: { column }, type: QueryTypes.SELECT }
  );
  return row?.type ?? null;
};

// sequelize.sync() creates missing tables but never changes existing ones, so bring an older
// scans table up to date here. Each step checks first, so on a current database this does nothing.
const migrateScans = async () => {
  try {
    // `result` started as an ENUM of lowercase values; it's now a VARCHAR of uppercase
    // statuses, and 'recorded' became 'SCANNED'.
    const resultType = await columnType('result');
    if (resultType?.startsWith('enum')) {
      await sequelize.query('ALTER TABLE scans MODIFY `result` VARCHAR(20) NOT NULL');
      await sequelize.query(
        "UPDATE scans SET `result` = CASE WHEN `result` = 'recorded' THEN 'SCANNED' ELSE UPPER(`result`) END"
      );
      console.log('scans.result migrated to uppercase statuses.');
    }

    if (resultType && !(await columnType('image_revealed_at'))) {
      await sequelize.query('ALTER TABLE scans ADD COLUMN image_revealed_at DATETIME NULL AFTER longitude');
      console.log('scans.image_revealed_at added.');
    }
  } catch (err) {
    // Keep the API up; only scanning depends on this table.
    console.error('Could not migrate the scans table:', err.message);
  }
};

module.exports = migrateScans;
