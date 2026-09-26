const { UserProfileVersion } = require('../models');

// The details that identify a user to admins. Whenever any of them changes a new version is
// saved, so a rename (Harish → Kumar) never hides who generated earlier QR batches.
const TRACKED_FIELDS = ['name', 'email', 'address', 'userType', 'mobile'];

// Blank and missing are the same thing.
const clean = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
};

// Emails compare case-insensitively; everything else exactly (after trimming).
const comparable = (field, value) => {
  const text = clean(value);
  return field === 'email' && text ? text.toLowerCase() : text;
};

// Fields that differ between two profiles (versions or users), as [{ field, from, to }].
const profileChanges = (before, after) =>
  TRACKED_FIELDS.filter((field) => comparable(field, before?.[field]) !== comparable(field, after?.[field])).map(
    (field) => ({ field, from: clean(before?.[field]), to: clean(after?.[field]) })
  );

// Saves the user's current details as a new version unless they match the latest one, and
// returns the version that now describes the user. `source` is 'self', 'admin' (pass
// changedBy) or 'system'.
const recordProfileVersion = async (user, { source, changedBy = null, transaction } = {}) => {
  const latest = await UserProfileVersion.findOne({
    where: { userId: user.id },
    order: [['versionNo', 'DESC']],
    transaction,
  });
  if (latest && profileChanges(latest, user).length === 0) return latest;

  return UserProfileVersion.create(
    {
      userId: user.id,
      versionNo: latest ? latest.versionNo + 1 : 1,
      ...Object.fromEntries(TRACKED_FIELDS.map((field) => [field, clean(user[field])])),
      source,
      changedBy,
    },
    { transaction }
  );
};

// For the admin user list: how many real edits (a value that was set changed or was cleared —
// filling in a blank doesn't count) and every earlier name that differs from the current one.
// `versions` must be one user's versions in versionNo order.
const summarizeHistory = (versions) => {
  const current = versions[versions.length - 1];
  let editCount = 0;
  for (let i = 1; i < versions.length; i++) {
    if (profileChanges(versions[i - 1], versions[i]).some((change) => change.from !== null)) editCount += 1;
  }

  const seen = new Set([comparable('name', current?.name)]);
  const previousNames = [];
  for (const version of versions) {
    const key = comparable('name', version.name);
    if (key && !seen.has(key)) {
      seen.add(key);
      previousNames.push(clean(version.name));
    }
  }

  return { versionCount: versions.length, editCount, previousNames };
};

// summarizeHistory for many users at once, as a Map of userId → summary.
const historySummaries = async (userIds) => {
  if (!userIds.length) return new Map();
  const versions = await UserProfileVersion.findAll({
    where: { userId: userIds },
    order: [
      ['userId', 'ASC'],
      ['versionNo', 'ASC'],
    ],
  });
  const byUser = new Map();
  for (const version of versions) {
    if (!byUser.has(version.userId)) byUser.set(version.userId, []);
    byUser.get(version.userId).push(version);
  }
  return new Map(userIds.map((id) => [id, summarizeHistory(byUser.get(id) || [])]));
};

module.exports = { TRACKED_FIELDS, profileChanges, recordProfileVersion, historySummaries };
