const { randomUUID } = require('crypto');
const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

const columnType = async (table, column) => {
  const [row] = await sequelize.query(
    `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { replacements: { table, column }, type: QueryTypes.SELECT }
  );
  return row?.type ?? null;
};

// Public UUIDs (shown as Scan ID / QR ID) alongside the numeric primary keys. The column stays
// nullable in the database so a server that predates it can still insert rows; any gaps are
// filled here on every start.
const ensureUuid = async (table) => {
  if (!(await columnType(table, 'uuid'))) {
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN uuid CHAR(36) NULL`);
    await sequelize.query(`ALTER TABLE ${table} ADD UNIQUE INDEX uq_${table}_uuid (uuid)`);
    console.log(`${table}.uuid added.`);
  }

  let filled = 0;
  for (;;) {
    const rows = await sequelize.query(`SELECT id FROM ${table} WHERE uuid IS NULL LIMIT 500`, {
      type: QueryTypes.SELECT,
    });
    if (!rows.length) break;
    const ids = rows.map((row) => Number(row.id));
    const cases = ids.map((id) => `WHEN ${id} THEN '${randomUUID()}'`).join(' ');
    await sequelize.query(`UPDATE ${table} SET uuid = CASE id ${cases} END WHERE id IN (${ids.join(',')})`);
    filled += ids.length;
  }
  if (filled) console.log(`${table}.uuid filled for ${filled} row(s).`);
};

// Stock images get a gap-free number (1, 2, 3, …) in upload order, separate from the
// auto-increment id (which can have gaps). Nullable in the database for rows written by older
// servers; those are numbered here, after the existing ones, on every start.
const ensureImageSerials = async () => {
  if (!(await columnType('image_assets', 'serial_no'))) {
    await sequelize.query('ALTER TABLE image_assets ADD COLUMN serial_no INT UNSIGNED NULL AFTER id');
    await sequelize.query('ALTER TABLE image_assets ADD UNIQUE INDEX uq_image_assets_serial (serial_no)');
    console.log('image_assets.serial_no added.');
  }

  const unnumbered = await sequelize.query(
    'SELECT id FROM image_assets WHERE serial_no IS NULL ORDER BY created_at, id',
    { type: QueryTypes.SELECT }
  );
  if (!unnumbered.length) return;
  const [{ last }] = await sequelize.query('SELECT COALESCE(MAX(serial_no), 0) AS last FROM image_assets', {
    type: QueryTypes.SELECT,
  });
  let next = Number(last);
  for (const { id } of unnumbered) {
    next += 1;
    await sequelize.query('UPDATE image_assets SET serial_no = :next WHERE id = :id', { replacements: { next, id } });
  }
  console.log(`image_assets.serial_no filled for ${unnumbered.length} image(s).`);
};

// sequelize.sync() creates missing tables but never changes existing ones, so bring older
// tables up to date here. Each step checks first, so on a current database this does nothing.
const migrateScans = async () => {
  try {
    // `result` started as an ENUM of lowercase values; it's now a VARCHAR of uppercase
    // statuses, and 'recorded' became 'SCANNED'.
    const resultType = await columnType('scans', 'result');
    if (resultType?.startsWith('enum')) {
      await sequelize.query('ALTER TABLE scans MODIFY `result` VARCHAR(20) NOT NULL');
      await sequelize.query(
        "UPDATE scans SET `result` = CASE WHEN `result` = 'recorded' THEN 'SCANNED' ELSE UPPER(`result`) END"
      );
      console.log('scans.result migrated to uppercase statuses.');
    }

    if (resultType && !(await columnType('scans', 'image_revealed_at'))) {
      await sequelize.query('ALTER TABLE scans ADD COLUMN image_revealed_at DATETIME NULL AFTER longitude');
      console.log('scans.image_revealed_at added.');
    }

    if (resultType && !(await columnType('scans', 'location_name'))) {
      await sequelize.query('ALTER TABLE scans ADD COLUMN location_name VARCHAR(255) NULL AFTER longitude');
      console.log('scans.location_name added.');
    }

    await ensureUuid('scans');
    await ensureUuid('qr_codes');

    // Who generated each batch, so they can follow their stickers' journeys. Batches made
    // before this column existed stay NULL (only admins see their full journeys).
    if (!(await columnType('qr_batches', 'created_by'))) {
      await sequelize.query('ALTER TABLE qr_batches ADD COLUMN created_by INT UNSIGNED NULL');
      await sequelize.query(
        'ALTER TABLE qr_batches ADD CONSTRAINT fk_qr_batches_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL'
      );
      console.log('qr_batches.created_by added.');
    }

    await ensureImageSerials();

    // Paper size each batch's sticker PDF is laid out for; older batches (NULL) print on A4.
    if (!(await columnType('qr_batches', 'page_size'))) {
      await sequelize.query('ALTER TABLE qr_batches ADD COLUMN page_size VARCHAR(2) NULL AFTER split_type');
      console.log('qr_batches.page_size added.');
    }
  } catch (err) {
    // Keep the API up; the new columns only add detail to scans and stickers.
    console.error('Could not migrate the database:', err.message);
  }
};

module.exports = migrateScans;
