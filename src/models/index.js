const sequelize = require('../config/db');
const User = require('./User');
const Otp = require('./Otp');
const ImageFolder = require('./ImageFolder');
const ImageAsset = require('./ImageAsset');
const QrBatch = require('./QrBatch');
const QrCode = require('./QrCode');

ImageFolder.hasMany(ImageAsset, { foreignKey: 'folderId', as: 'images', onDelete: 'CASCADE' });
ImageAsset.belongsTo(ImageFolder, { foreignKey: 'folderId', as: 'folder' });

ImageFolder.hasMany(QrBatch, { foreignKey: 'folderId', as: 'qrBatches' });
QrBatch.belongsTo(ImageFolder, { foreignKey: 'folderId', as: 'folder' });

QrBatch.hasMany(QrCode, { foreignKey: 'batchId', as: 'codes', onDelete: 'CASCADE' });
QrCode.belongsTo(QrBatch, { foreignKey: 'batchId', as: 'batch' });

module.exports = {
  sequelize,
  User,
  Otp,
  ImageFolder,
  ImageAsset,
  QrBatch,
  QrCode,
};
