const sequelize = require('../config/db');
const User = require('./User');
const Otp = require('./Otp');
const ImageFolder = require('./ImageFolder');
const ImageAsset = require('./ImageAsset');
const QrBatch = require('./QrBatch');
const QrCode = require('./QrCode');
const Scan = require('./Scan');
const ScanReport = require('./ScanReport');
const UserProfileVersion = require('./UserProfileVersion');
const Wallet = require('./Wallet');
const WalletTopup = require('./WalletTopup');
const WalletTransaction = require('./WalletTransaction');
const PlanSubscription = require('./PlanSubscription');

ImageFolder.hasMany(ImageAsset, { foreignKey: 'folderId', as: 'images', onDelete: 'CASCADE' });
ImageAsset.belongsTo(ImageFolder, { foreignKey: 'folderId', as: 'folder' });

ImageFolder.hasMany(QrBatch, { foreignKey: 'folderId', as: 'qrBatches' });
QrBatch.belongsTo(ImageFolder, { foreignKey: 'folderId', as: 'folder' });

User.hasMany(QrBatch, { foreignKey: 'createdBy', as: 'qrBatches', onDelete: 'SET NULL' });
QrBatch.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

User.hasMany(UserProfileVersion, { foreignKey: 'userId', as: 'profileVersions', onDelete: 'CASCADE' });
UserProfileVersion.belongsTo(User, { foreignKey: 'userId', as: 'user' });
// The admin behind an 'admin' change; the history row stays if that admin is deleted.
UserProfileVersion.belongsTo(User, { foreignKey: 'changedBy', as: 'editor', onDelete: 'SET NULL' });

UserProfileVersion.hasMany(QrBatch, { foreignKey: 'creatorProfileVersionId', as: 'qrBatches', onDelete: 'SET NULL' });
QrBatch.belongsTo(UserProfileVersion, { foreignKey: 'creatorProfileVersionId', as: 'creatorProfile' });

QrBatch.hasMany(QrCode, { foreignKey: 'batchId', as: 'codes', onDelete: 'CASCADE' });
QrCode.belongsTo(QrBatch, { foreignKey: 'batchId', as: 'batch' });

User.hasMany(Scan, { foreignKey: 'userId', as: 'scans', onDelete: 'CASCADE' });
Scan.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// A deleted sticker leaves its scan history in place, just unlinked.
QrCode.hasMany(Scan, { foreignKey: 'qrCodeId', as: 'scans', onDelete: 'SET NULL' });
Scan.belongsTo(QrCode, { foreignKey: 'qrCodeId', as: 'qrCode' });

Scan.hasOne(ScanReport, { foreignKey: 'scanId', as: 'report', onDelete: 'CASCADE' });
ScanReport.belongsTo(Scan, { foreignKey: 'scanId', as: 'scan' });

User.hasOne(Wallet, { foreignKey: 'userId', as: 'wallet', onDelete: 'CASCADE' });
Wallet.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(WalletTopup, { foreignKey: 'userId', as: 'walletTopups', onDelete: 'CASCADE' });
WalletTopup.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(WalletTransaction, { foreignKey: 'userId', as: 'walletTransactions', onDelete: 'CASCADE' });
WalletTransaction.belongsTo(User, { foreignKey: 'userId', as: 'user' });
// The ledger keeps its row (and amount) if the top-up or batch behind it is ever removed.
WalletTransaction.belongsTo(WalletTopup, { foreignKey: 'topupId', as: 'topup', onDelete: 'SET NULL' });
WalletTransaction.belongsTo(QrBatch, { foreignKey: 'batchId', as: 'batch', onDelete: 'SET NULL' });

User.hasMany(PlanSubscription, { foreignKey: 'userId', as: 'planSubscriptions', onDelete: 'CASCADE' });
PlanSubscription.belongsTo(User, { foreignKey: 'userId', as: 'user' });

module.exports = {
  sequelize,
  User,
  Otp,
  ImageFolder,
  ImageAsset,
  QrBatch,
  QrCode,
  Scan,
  ScanReport,
  UserProfileVersion,
  Wallet,
  WalletTopup,
  WalletTransaction,
  PlanSubscription,
};
