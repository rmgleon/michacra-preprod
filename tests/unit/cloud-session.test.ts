import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as null | { uid: string; emailVerified: boolean }, authStateReady: async () => {} },
  getDoc: vi.fn(), getDocs: vi.fn(), onSnapshot: vi.fn(), transaction: vi.fn()
}));
vi.mock('firebase/app', () => ({ getApps: () => [{}], getApp: () => ({}), initializeApp: () => ({}) }));
vi.mock('firebase/auth', () => ({ getAuth: () => mocks.auth }));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}), doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  collection: (_db: unknown, collection: string) => ({ collection }),
  getDoc: mocks.getDoc, getDocs: mocks.getDocs, onSnapshot: mocks.onSnapshot,
  runTransaction: mocks.transaction, serverTimestamp: () => 'server-time',
  query: (source: unknown) => source, where: vi.fn()
}));
vi.mock('../../src/services/firebaseClient', () => ({ firebaseStorage: {} }));

import { getDatabaseSession, switchDatabaseForUser } from '../../src/db/dexieDb';
import { subscribeToCloudProducers, syncCloudWithLocal, uploadQueueItem } from '../../src/services/firestoreSync';

const account = { active: true, approvalStatus: 'approved', role: 'ADMINISTRADOR', fullName: 'Admin', assignedMunicipalities: [] };
const snapshot = (data: any) => ({ exists: () => true, data: () => data });
const producer = { id: 'producer-a', dni: '30123456', fullName: 'Ana', municipalityId: 'obera', syncStatus: 'synced', cloudRevision: 1 };

describe('cloud operations retain their originating account', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('crypto', webcrypto);
    await switchDatabaseForUser('cloud-a');
    mocks.auth.currentUser = { uid: 'cloud-a', emailVerified: true };
    await Promise.all(getDatabaseSession().db.tables.map((table) => table.clear()));
    mocks.getDoc.mockResolvedValue(snapshot(account));
    mocks.getDocs.mockResolvedValue({ docs: [] });
  });
  afterEach(async () => {
    mocks.auth.currentUser = null;
    await switchDatabaseForUser();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('discards a late download without deleting or inserting records in the next account', async () => {
    let finish!: (value: any) => void;
    mocks.getDocs.mockImplementation((source: any) => source.collection === 'producers'
      ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ docs: [] }));
    const download = syncCloudWithLocal();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await switchDatabaseForUser('cloud-b');
    mocks.auth.currentUser = { uid: 'cloud-b', emailVerified: true };
    const next = getDatabaseSession().db;
    await next.producers.clear();
    await next.producers.put({ ...producer, id: 'b-only' } as any);
    finish({ docs: [{ id: producer.id, data: () => producer }] });
    await download;
    expect(await next.producers.toArray()).toEqual([expect.objectContaining({ id: 'b-only' })]);
  });

  it('stops a listener that was already awaiting a local read when the account changes', async () => {
    let receive!: (value: any) => void;
    mocks.onSnapshot.mockImplementation((_query: unknown, callback: typeof receive) => { receive = callback; return vi.fn(); });
    const onUpdate = vi.fn();
    const stop = subscribeToCloudProducers(onUpdate);
    await vi.waitFor(() => expect(receive).toBeTypeOf('function'));
    let finish!: (value: any) => void;
    const previous = getDatabaseSession().db;
    vi.spyOn(previous.producers, 'get').mockImplementation(() => new Promise((resolve) => { finish = resolve; }) as any);
    receive({ docs: [{ id: producer.id, data: () => producer }] });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await switchDatabaseForUser('cloud-b');
    mocks.auth.currentUser = { uid: 'cloud-b', emailVerified: true };
    finish(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await getDatabaseSession().db.producers.get(producer.id)).toBeUndefined();
    expect(await previous.producers.count()).toBe(0);
    expect(onUpdate).not.toHaveBeenCalled();
    stop();
  });

  it('preserves server verification and WhatsApp provenance when uploading an edit', async () => {
    const cloud = { ...producer, createdAt: 'original-date', createdById: 'whatsapp:sender', createdByName: 'Ana',
      whatsappPhone: '5493755123456', registrationSource: 'whatsapp', verificationStatus: 'verified',
      verifiedBySupervisor: true, verifiedById: 'reviewer', verifiedByName: 'Reviewer', verifiedAt: 'review-date' };
    mocks.getDoc.mockImplementation((ref: any) => Promise.resolve(snapshot(ref.collection === 'users' ? account : cloud)));
    const set = vi.fn();
    mocks.transaction.mockImplementation((_db: unknown, callback: any) => callback({ get: async () => snapshot(cloud), set }));
    const result = await uploadQueueItem({ id: 'queue', table: 'producers', action: 'update', recordId: producer.id,
      payload: { ...cloud, fullName: 'Ana editada', registrationSource: 'admin', verifiedBySupervisor: false, verificationStatus: 'unverified', syncStatus: 'pending' },
      idempotencyKey: 'operation-metadata-test', baseRevision: 1, attempts: 0, status: 'pending', createdAt: 'now' });
    expect(result.ok).toBe(true);
    const { syncStatus, ...sharedCloud } = cloud;
    expect(set.mock.calls[0][1]).toMatchObject({ ...sharedCloud, fullName: 'Ana editada', cloudRevision: 2 });
    expect(set.mock.calls[0][1]).not.toHaveProperty('syncStatus');
  });
});
