// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth';
import { connectStorageEmulator, getMetadata, getStorage, ref, uploadBytes } from 'firebase/storage';

const app = initializeApp({ projectId: 'demo-sip-misiones-tests', apiKey: 'demo-key', storageBucket: 'demo-sip-misiones-tests.appspot.com' }, `photo-rules-${randomUUID()}`);
const auth = getAuth(app);
const storage = getStorage(app);

afterAll(async () => deleteApp(app));

it('accepts operation-specific photo paths and legacy paths while keeping objects private', async () => {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Run through npm run test:rules.');
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  const { user } = await createUserWithEmailAndPassword(auth, `photos-${randomUUID()}@example.test`, 'password-123456');
  const current = ref(storage, `responses/${user.uid}/producer/photo_${'a'.repeat(64)}_0.jpg`);
  const legacy = ref(storage, `responses/${user.uid}/producer/photo_0.jpg`);
  const bytes = new Uint8Array([1, 2, 3]);
  await expect(uploadBytes(current, bytes, { contentType: 'image/jpeg' })).resolves.toBeDefined();
  await expect(uploadBytes(legacy, bytes, { contentType: 'image/jpeg' })).resolves.toBeDefined();
  await expect(uploadBytes(ref(storage, `responses/someone-else/producer/photo_0.jpg`), bytes, { contentType: 'image/jpeg' })).rejects.toMatchObject({ code: 'storage/unauthorized' });
  await expect(uploadBytes(ref(storage, `responses/${user.uid}/producer/arbitrary.jpg`), bytes, { contentType: 'image/jpeg' })).rejects.toMatchObject({ code: 'storage/unauthorized' });
  await signOut(auth);
  await expect(getMetadata(current)).rejects.toMatchObject({ code: 'storage/unauthorized' });
});
