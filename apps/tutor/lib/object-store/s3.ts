import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getObjectStoreConfig } from "./config";
import { isSafeObjectKey } from "./keys";
import { mediaProxyUrl } from "./mediaUrl";

export { boardAudioPrefix, userImagePrefix } from "./keys";

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

async function putObject(
  key: string,
  bytes: Uint8Array,
  contentType: string,
  signal?: AbortSignal,
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
      { abortSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) },
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

export async function deletePrefix(prefix: string): Promise<void> {
  const folder = /^(?:lectures\/[A-Za-z0-9._-]{1,128}\/(?:[A-Za-z0-9._-]{1,128}\/)?|images\/[A-Za-z0-9._-]{1,128}\/)$/;
  const imageKey = prefix.startsWith("images/") && isSafeObjectKey(prefix) && !prefix.endsWith("/");
  if ((!folder.test(prefix) && !imageKey) || prefix.includes("..")) throw new Error("invalid object deletion prefix");
  const config = getObjectStoreConfig();
  const client = getClient();
  if (!config || !client) throw new Error("object storage deletion is not configured");
  const signal = AbortSignal.timeout(45_000);
  const deleteKeys = async (objects: Array<{ Key: string }>) => {
    const result = await client.send(new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: objects, Quiet: true } }), { abortSignal: signal });
    if (result.Errors?.length) throw new Error("object deletion was rejected by storage");
  };
  if (imageKey) { await deleteKeys([{ Key: prefix }]); return; }

  let token: string | undefined;
  const seenTokens = new Set<string>();
  let pages = 0;
  do {
    if (++pages > 100) throw new Error("object deletion pagination exceeds its page limit");
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
      { abortSignal: signal },
    );
    const objects = (listed.Contents ?? [])
      .map((entry) => entry.Key)
      .filter((key): key is string => Boolean(key))
      .map((Key) => ({ Key }));
    if (objects.length > 0) {
      if (objects.some(({ Key }) => !Key.startsWith(prefix))) throw new Error("object deletion escaped its prefix");
      await deleteKeys(objects);
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    if (listed.IsTruncated && (!token || seenTokens.has(token))) throw new Error("invalid object deletion pagination");
    if (token) seenTokens.add(token);
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
  signal?: AbortSignal,
): Promise<string | null> {
  return putObject(key, bytes, contentType, signal);
}
