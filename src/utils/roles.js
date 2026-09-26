// Admins and super-admins see every user's scans and every sticker's full journey.
const isAdminUser = (user) => Boolean(user?.isAdmin || user?.isSuperAdmin);

// Everyone's scans of a sticker are visible to admins and to the user who generated its batch;
// anyone else only sees their own. `codeRow` needs its `batch` loaded.
const canSeeFullJourney = (user, codeRow) =>
  isAdminUser(user) || (Boolean(codeRow?.batch?.createdBy) && codeRow.batch.createdBy === user?.id);

module.exports = { isAdminUser, canSeeFullJourney };
