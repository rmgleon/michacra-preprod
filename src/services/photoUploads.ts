/** Each queued operation owns its objects, so retries cannot overwrite older photos. */
export async function uploadInlinePhotos(
  value: any,
  uid: string,
  recordId: string,
  operationId: string,
  upload: (dataUrl: string, path: string) => Promise<void>
): Promise<any> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(operationId));
  const operationHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  let index = 0;
  async function visit(item: any): Promise<any> {
    if (typeof item === 'string' && item.startsWith('data:image/')) {
      const path = `responses/${uid}/${recordId}/photo_${operationHash}_${index++}.jpg`;
      await upload(item, path);
      return `storagePath:${path}`;
    }
    if (Array.isArray(item)) return Promise.all(item.map(visit));
    if (item && typeof item === 'object') {
      return Object.fromEntries(await Promise.all(Object.entries(item).map(async ([key, nested]) => [key, await visit(nested)])));
    }
    return item;
  }
  return visit(value);
}
