import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getObjectStoreConfig } from "./config";
import { isSafeObjectKey } from "./keys";
import { mediaProxyUrl } from "./mediaUrl";

export { isObjectStoreConfigured, getObjectStoreConfig } from "./config";
export { lectureAudioKey, boardAudioPrefix, questionImageKey, userImagePrefix } from "./keys";
export { mediaProxyUrl } from "./mediaUrl";

let cachedClient: S3Client | null | undefined;

function getClient(): S3Client | null {
  if (cachedClient !== undefined) return cachedClient;
  const config = getObjectStoreConfig();
  if (!config) {
    cachedClient = null;
    return null;
  }
  cachedClient = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });
  return cachedClient;
}

export type StoredObjectBody = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
};

export async function putObject(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
  if (!isSafeObjectKey(key)) return null;
  const config = getObjectStoreConfig();
  const client = getClient();
  if (!config || !client) return null;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: Buffer.from(bytes),
        ContentType: contentType,
      }),
    );
    return mediaProxyUrl(key);
  } catch (error) {
    console.error("S3 put skipped; object will not be stored", error);
    return null;
  }
}

export async function getObject(key: string): Promise<StoredObjectBody | null> {
  if (!isSafeObjectKey(key)) return null;
  const config = getObjectStoreConfig();
  const client = getClient();
  if (!config || !client) return null;

  try {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
    );
    const body = result.Body;
    if (!body || typeof body.transformToWebStream !== "function") {
      return null;
    }
    return {
      body: body.transformToWebStream() as ReadableStream<Uint8Array>,
      contentType: result.ContentType || "application/octet-stream",
    };
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<boolean> {
  if (!isSafeObjectKey(key)) return false;
  const config = getObjectStoreConfig();
  const client = getClient();
  if (!config || !client) return false;

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function deletePrefix(prefix: string): Promise<void> {
  const config = getObjectStoreConfig();
  const client = getClient();
  if (!config || !client) return;
  if (!prefix.startsWith("lectures/") && !prefix.startsWith("images/")) return;
  if (prefix.includes("..")) return;

  let token: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    const objects = (listed.Contents ?? [])
      .map((entry) => entry.Key)
      .filter((key): key is string => Boolean(key))
      .map((Key) => ({ Key }));
    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: { Objects: objects, Quiet: true },
        }),
      );
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
}

export async function uploadAudio(
  key: string,
  bytes: Uint8Array,
  contentType = "audio/mpeg",
): Promise<string | null> {
  return putObject(key, bytes, contentType);
}

export async function uploadImage(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
  return putObject(key, bytes, contentType);
}

export async function deleteAudio(key: string): Promise<boolean> {
  return deleteObject(key);
}

export async function deleteAudioBulk(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => deleteAudio(key)));
}
