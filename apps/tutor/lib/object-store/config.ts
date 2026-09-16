export type ObjectStoreConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  publicBaseUrl: string | null;
};

export function getObjectStoreConfig(): ObjectStoreConfig | null {
  const bucket = process.env.S3_BUCKET?.trim() || process.env.R2_BUCKET?.trim();
  if (!bucket) return null;

  const region =
    process.env.AWS_REGION?.trim() || process.env.S3_REGION?.trim() || "ap-south-2";
  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const publicBaseUrl =
    process.env.S3_PUBLIC_BASE_URL?.trim() || process.env.R2_PUBLIC_BASE_URL?.trim() || null;

  return { bucket, region, endpoint, publicBaseUrl };
}

export function isObjectStoreConfigured(): boolean {
  return getObjectStoreConfig() !== null;
}
