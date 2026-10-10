import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getObjectStoreConfig } from "./config";
import { isSafeObjectDeletionPrefix, isSafeObjectKey } from "./keys";
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

export type ObjectSize = { status: "found"; bytes: number } | { status: "missing" };

/** Only a provider 404 establishes absence; access errors must retain charges. */
export async function headObjectSize(key: string, signal?: AbortSignal): Promise<ObjectSize> {
  if (!isSafeObjectKey(key)) throw new Error("invalid storage measurement key");
  const config = getObjectStoreConfig();
  const client = getClient();
  if (!config || !client) throw new Error("storage measurement is not configured");
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }), {
      abortSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000),
    });
    if (!Number.isSafeInteger(result.ContentLength) || (result.ContentLength ?? -1) < 0) {
      throw new Error("storage measurement returned an invalid size");
    }
    return { status: "found", bytes: result.ContentLength! };
  } catch (error) {
    const status = typeof error === "object" && error !== null && "$metadata" in error
      ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode : undefined;
    if (status === 404) return { status: "missing" };
    throw new Error("storage object size could not be verified");
  }
}

/** Read-only bounded inventory, also used to prove an expired attempt empty. */
export async function listObjectSizes(prefix: string, parentSignal?: AbortSignal): Promise<Array<{ key: string; bytes: number }>> {
  if (!isSafeObjectDeletionPrefix(prefix)) throw new Error("invalid storage measurement prefix");
  const config = getObjectStoreConfig();
  const client = getClient();
  if (!config || !client) throw new Error("storage measurement is not configured");
  const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const objects: Array<{ key: string; bytes: number }> = [];
  const tokens = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000,
    }), { abortSignal: signal });
    if (typeof result.IsTruncated !== "boolean") throw new Error("storage inventory completion is unverified");
    for (const object of result.Contents ?? []) {
      if (!object.Key?.startsWith(prefix) || !Number.isSafeInteger(object.Size) || (object.Size ?? -1) < 0) {
        throw new Error("storage inventory returned an invalid object");
      }
      objects.push({ key: object.Key, bytes: object.Size! });
    }
    if (!result.IsTruncated) return objects;
    token = result.NextContinuationToken;
    if (!token || tokens.has(token)) throw new Error("storage inventory pagination is invalid");
    tokens.add(token);
  }
  throw new Error("storage inventory exceeds its page limit");
}

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
  const imageKey = prefix.startsWith("images/") && isSafeObjectKey(prefix) && !prefix.endsWith("/");
  if (!isSafeObjectDeletionPrefix(prefix)) throw new Error("invalid object deletion prefix");
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
    if (typeof listed.IsTruncated !== "boolean") throw new Error("object deletion inventory completion is unverified");
    const objects = (listed.Contents ?? [])
      .map(({ Key }) => {
        if (typeof Key !== "string" || !Key) throw new Error("object deletion inventory returned an invalid key");
        return { Key };
      });
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
  signal?: AbortSignal,
): Promise<string | null> {
  return putObject(key, bytes, contentType, signal);
}

export async function uploadImage(
  key: string,
  bytes: Uint8Array,
  contentType: string,
  signal?: AbortSignal,
): Promise<string | null> {
  return putObject(key, bytes, contentType, signal);
}
