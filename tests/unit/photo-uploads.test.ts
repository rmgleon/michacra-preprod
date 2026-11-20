import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { uploadInlinePhotos } from '../../src/services/photoUploads';

afterEach(() => vi.unstubAllGlobals());

it('keeps existing photos and assigns different objects to new operations, with stable retry paths', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const existing = 'storagePath:responses/technician/producer/photo_0.jpg';
  const saved = new Map<string, string>([[existing.slice('storagePath:'.length), 'original-image']]);
  const upload = vi.fn(async (data: string, path: string) => { saved.set(path, data); });
  const payload = { photoUrls: [existing, 'data:image/jpeg;base64,new-image'] };
  const first = await uploadInlinePhotos(payload, 'technician', 'producer', 'operation-one', upload);
  const retry = await uploadInlinePhotos(payload, 'technician', 'producer', 'operation-one', upload);
  const later = await uploadInlinePhotos(payload, 'technician', 'producer', 'operation-two', upload);
  expect(saved.get(existing.slice('storagePath:'.length))).toBe('original-image');
  expect(first.photoUrls[0]).toBe(existing);
  expect(first.photoUrls[1]).not.toBe(existing);
  expect(retry).toEqual(first);
  expect(later.photoUrls[1]).not.toBe(first.photoUrls[1]);
  expect(saved.size).toBe(3);
});
