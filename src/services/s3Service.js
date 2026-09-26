const AWS = require('aws-sdk');

const resolveEnv = (primary, fallback) => {
  const value = process.env[primary] || process.env[fallback];
  return value && String(value).trim() ? value : undefined;
};

const requiredConfig = [
  ['AWS_S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'],
  ['AWS_S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'],
  ['AWS_S3_REGION', 'AWS_REGION'],
  ['AWS_S3_BUCKET', 'S3_BUCKET'],
];

const getAwsConfig = () => {
  const missing = requiredConfig.filter(([primary, fallback]) => {
    const value = resolveEnv(primary, fallback);
    return !value;
  }).map(([primary, fallback]) => primary || fallback);

  if (missing.length) {
    throw new Error(
      `Missing AWS S3 configuration: ${missing.join(', ')}. Add them to backend/.env before uploading images.`
    );
  }

  const accessKeyId = resolveEnv('AWS_S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = resolveEnv('AWS_S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY');
  const region = resolveEnv('AWS_S3_REGION', 'AWS_REGION');
  const bucket = resolveEnv('AWS_S3_BUCKET', 'S3_BUCKET');

  return {
    accessKeyId,
    secretAccessKey,
    region,
    bucket,
    baseUrl: resolveEnv('AWS_S3_PUBLIC_BASE_URL', 'S3_PUBLIC_BASE_URL') || `https://${bucket}.s3.${region}.amazonaws.com`,
    folder: resolveEnv('AWS_S3_UPLOAD_FOLDER', 'S3_UPLOAD_FOLDER') || 'profile-photos',
  };
};

const s3 = () => {
  const config = getAwsConfig();

  AWS.config.update({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
  });

  return new AWS.S3();
};

const uploadFileToS3 = async (file, customFolder = null) => {
  if (!file) return null;

  const { bucket, folder, baseUrl } = getAwsConfig();
  const fileName = `${customFolder || folder}/${Date.now()}-${String(file.originalname || 'upload').replace(/\s+/g, '-')}`;

  const params = {
    Bucket: bucket,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype || 'application/octet-stream',
    // ACL is intentionally omitted because this bucket is configured to reject ACLs.
    // Public access should be granted via bucket policy instead of object ACLs.
  };

  const uploaded = await s3().upload(params).promise();

  return uploaded.Location || `${baseUrl}/${fileName}`;
};

// The object key behind a URL from uploadFileToS3 (virtual-hosted or path-style), or null.
const keyFromUrl = (url, bucket) => {
  try {
    const path = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
    return path.startsWith(`${bucket}/`) ? path.slice(bucket.length + 1) : path || null;
  } catch {
    return null;
  }
};

// Deletes files uploaded by uploadFileToS3, given their URLs. Only keys under `prefix` are
// touched, so a stray URL can never remove anything else in the bucket.
const deleteFilesFromS3 = async (urls, prefix) => {
  const { bucket } = getAwsConfig();
  const keys = urls.map((url) => keyFromUrl(url, bucket)).filter((key) => key && key.startsWith(prefix));
  for (let i = 0; i < keys.length; i += 1000) {
    const Objects = keys.slice(i, i + 1000).map((Key) => ({ Key }));
    await s3().deleteObjects({ Bucket: bucket, Delete: { Objects, Quiet: true } }).promise();
  }
  return keys.length;
};

module.exports = { uploadFileToS3, deleteFilesFromS3 };
