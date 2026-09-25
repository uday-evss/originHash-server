const sequelize = require('../config/db');
const User = require('./User');
const Otp = require('./Otp');
const ImageFolder = require('./ImageFolder');
const ImageAsset = require('./ImageAsset');
const QrBatch = require('./QrBatch');
const QrCode = require('./QrCode');
const Scan = require('./Scan');

ImageFolder.hasMany(ImageAsset, { foreignKey: 'folderId', as: 'images', onDelete: 'CASCADE' });
ImageAsset.belongsTo(ImageFolder, { foreignKey: 'folderId', as: 'folder' });

ImageFolder.hasMany(QrBatch, { foreignKey: 'folderId', as: 'qrBatches' });
QrBatch.belongsTo(ImageFolder, { foreignKey: 'folderId', as: 'folder' });

QrBatch.hasMany(QrCode, { foreignKey: 'batchId', as: 'codes', onDelete: 'CASCADE' });
QrCode.belongsTo(QrBatch, { foreignKey: 'batchId', as: 'batch' });

User.hasMany(Scan, { foreignKey: 'userId', as: 'scans', onDelete: 'CASCADE' });
Scan.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// A deleted sticker leaves its scan history in place, just unlinked.
QrCode.hasMany(Scan, { foreignKey: 'qrCodeId', as: 'scans', onDelete: 'SET NULL' });
Scan.belongsTo(QrCode, { foreignKey: 'qrCodeId', as: 'qrCode' });

module.exports = {
  sequelize,
  User,
  Otp,
  ImageFolder,
  ImageAsset,
  QrBatch,
  QrCode,
  Scan,
};
