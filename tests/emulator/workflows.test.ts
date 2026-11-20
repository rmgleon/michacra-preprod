import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { consumeMessage, deliverReply, type WhatsAppConfig } from '../../server/whatsapp';
import { reviewProducer } from '../../server/verification';
import { createApi } from '../../server/app';
import type { IncomingMessage } from '../../server/registration';
import type { Auth } from 'firebase-admin/auth';
import type { Server } from 'node:http';
import { setDoc, doc, updateDoc, getDoc } from 'firebase/firestore';

const projectId = 'demo-sip-whatsapp';
const adminApp = initializeApp({ projectId }, 'whatsapp-tests');
const db = getFirestore(adminApp);
const config: WhatsAppConfig = { appSecret: 'app-secret', verifyToken: 'verify-secret', accessToken: 'token', phoneNumberId: '12345678', graphVersion: 'v25.0' };
let rules: RulesTestEnvironment;
let server: Server;
let baseUrl: string;
let outgoing = 0;
const fakeFetch: typeof fetch = async () => { outgoing++; return new Response('{}', { status: 200 }); };
const fakeAuth = { verifyIdToken: async (token: string) => {
  if (token === 'bad') throw new Error('revoked');
  return { uid: token, email_verified: token !== 'unverified-email' };
} } as unknown as Auth;

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Run using npm run test:emulator');
  rules = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  const api = createApi({ db, auth: fakeAuth, whatsapp: config, fetcher: fakeFetch });
  server = api.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
beforeEach(async () => { await rules.clearFirestore(); outgoing = 0; });
after(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await rules?.cleanup(); await deleteApp(adminApp); });

const profile = (role: string, extra = {}) => ({ active: true, approvalStatus: 'approved', role, fullName: `${role} Test`, assignedMunicipalities: ['obera'], ...extra });
const producer = (extra = {}) => ({ id: 'producer-test', dni: '30123456', municipality: 'Oberá', municipalityId: 'obera', surfaceHa: null, lat: null, lng: null, isGeolocated: false, lastOperationId: 'operation-whatsapp-test', fullName: 'Ana Gómez',
  establishmentName: 'La Esperanza', createdById: 'admin', createdByName: 'Admin Test', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  verificationStatus: 'unverified', verifiedBySupervisor: false, registrationSource: 'whatsapp', cloudRevision: 1, version: 1, syncStatus: 'synced', ...extra });
const incoming = (body: string, id = `message-${body}`, from = '5493755123456'): IncomingMessage => ({ id, from, type: 'text', timestamp: String(Math.floor(Date.now() / 1000)), text: { body } });

async function readyToConfirm(from = '5493755123456', dni = '30123456') {
  for (const [i, answer] of ['registrar', dni, 'Ana Gómez', 'Oberá', 'La Esperanza', 'Picada Norte', '1', 'SÍ', '2,5', '1,2', '1', 'omitir'].entries()) {
    await consumeMessage(db, incoming(answer, `${from}-${i}`, from));
  }
}

test('concurrent redeliveries commit one unverified producer, with provenance and audit', async () => {
  await readyToConfirm();
  const confirmation = incoming('confirmar');
  const [eventA, eventB] = await Promise.all([consumeMessage(db, confirmation), consumeMessage(db, confirmation)]);
  assert.equal(eventA.path, eventB.path);
  const producers = await db.collection('producers').get();
  assert.equal(producers.size, 1);
  const record = producers.docs[0].data();
  assert.equal(record.verificationStatus, 'unverified');
  assert.equal(record.verifiedBySupervisor, false);
  assert.equal(record.registrationSource, 'whatsapp');
  assert.equal(record.municipalityId, 'obera');
  assert.equal(record.createdByName, record.fullName);
  assert.match(record.createdById, /^whatsapp:/);
  assert.equal(record.phone, '+5493755123456');
  assert.equal(record.isGeolocated, false);
  assert.equal(record.activities[0].producerId, record.id);
  assert.equal((await db.collection('auditLogs').get()).size, 1);
  await deliverReply(db, eventA, config, fakeFetch);
  await deliverReply(db, eventB, config, fakeFetch);
  assert.equal(outgoing, 1);
});

test('existing DNI and concurrent registrations from different phones cannot overwrite or duplicate a producer', async () => {
  await readyToConfirm();
  await readyToConfirm('5493755654321');
  await Promise.all([consumeMessage(db, incoming('confirmar', 'confirmation-a')), consumeMessage(db, incoming('confirmar', 'confirmation-b', '5493755654321'))]);
  assert.equal((await db.collection('producers').get()).size, 1);
  await db.collection('producers').doc('admin-existing').set(producer({ dni: '32123456' }));
  await readyToConfirm('5493755999999', '32123456');
  const event = await consumeMessage(db, incoming('confirmar', 'confirmation-c', '5493755999999'));
  assert.match((await event.get()).data()!.reply, /ya existe/);
  assert.equal((await db.collection('producers').get()).size, 2);
  assert.equal((await db.doc('producers/admin-existing').get()).data()!.fullName, 'Ana Gómez');
});

test('failed outbound delivery retries the saved reply without advancing the conversation', async () => {
  const event = await consumeMessage(db, incoming('registrar'));
  await assert.rejects(deliverReply(db, event, config, async () => new Response('{}', { status: 500 })));
  assert.equal((await event.get()).data()!.deliveredAt, null);
  const retry = await consumeMessage(db, incoming('registrar'));
  assert.equal(retry.path, event.path);
  await deliverReply(db, retry, config, fakeFetch);
  assert.equal(outgoing, 1);
  assert.equal((await db.collection('whatsappSessions').get()).docs[0].data()!.session.step, 'dni');
});

test('technician verifies an assigned producer; revocation and stale revisions are enforced and audited', async () => {
  await db.doc('users/tech').set(profile('TECNICO'));
  await db.doc('producers/producer-test').set(producer({ createdById: 'whatsapp:original-producer', createdByName: 'Ana Gómez' }));
  const verified = await reviewProducer(db, 'tech', 'producer-test', 'verified', 1);
  assert.equal(verified.verificationStatus, 'verified');
  assert.equal(verified.verifiedById, 'tech');
  assert.equal(verified.cloudRevision, 2);
  const persisted = (await db.doc('producers/producer-test').get()).data()!;
  assert.equal(persisted.registrationSource, 'whatsapp');
  assert.equal(persisted.createdById, 'whatsapp:original-producer');
  assert.equal(persisted.createdByName, 'Ana Gómez');
  assert.equal(verified.lastSyncedAt, verified.updatedAt);
  await assert.rejects(reviewProducer(db, 'tech', 'producer-test', ['verified'], 2), { status: 400 });
  await assert.rejects(reviewProducer(db, 'tech', 'producer-test', 'unverified', 1), { status: 409 });
  await db.doc('users/tech').update({ active: false });
  await assert.rejects(reviewProducer(db, 'tech', 'producer-test', 'unverified', 2), { status: 403 });
  await db.doc('users/admin').set(profile('ADMINISTRADOR'));
  const reverted = await reviewProducer(db, 'admin', 'producer-test', 'unverified', 2);
  assert.equal(reverted.verifiedBySupervisor, false);
  assert.equal(reverted.verifiedById, '');
  assert.equal((await db.collection('auditLogs').get()).size, 2);
});

test('unassigned technicians, pending users and directors cannot verify', async () => {
  await db.doc('producers/producer-test').set(producer());
  for (const [id, account] of [
    ['other-tech', profile('TECNICO', { assignedMunicipalities: ['posadas'] })],
    ['pending', profile('TECNICO', { approvalStatus: 'pending' })],
    ['director', profile('DIRECTOR')],
  ] as const) {
    await db.doc(`users/${id}`).set(account);
    await assert.rejects(reviewProducer(db, id, 'producer-test', 'verified', 1), { status: 403 });
  }
  assert.equal((await db.collection('auditLogs').get()).size, 0);
});

test('ESTADO only reports the producer linked to the requesting number', async () => {
  await readyToConfirm();
  await consumeMessage(db, incoming('confirmar'));
  const own = await consumeMessage(db, incoming('ESTADO', 'status-1'));
  assert.match((await own.get()).data()!.reply, /SIN VERIFICAR/);
  const other = await consumeMessage(db, incoming('ESTADO', 'status-2', '5493755654321'));
  assert.match((await other.get()).data()!.reply, /No hay una ficha/);
});

test('HTTP webhook challenge, signature, batched messages and status-only events', async () => {
  const valid = await fetch(`${baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=1234`);
  assert.equal(await valid.text(), '1234');
  assert.equal((await fetch(`${baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1234`)).status, 403);
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: config.phoneNumberId }, messages: [incoming('hola', 'batch-a'), incoming('registrar', 'batch-b')],
  } }] }] });
  const signature = `sha256=${createHmac('sha256', config.appSecret).update(body).digest('hex')}`;
  const request = (sig: string) => fetch(`${baseUrl}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig }, body });
  assert.equal((await request('sha256=bad')).status, 401);
  assert.equal((await request(signature)).status, 200);
  assert.equal(outgoing, 2);
  assert.equal((await request(signature)).status, 200);
  assert.equal(outgoing, 2);
  assert.equal((await db.collection('whatsappEvents').get()).size, 2);
});

test('HTTP verification requires valid Firebase identity and approved role', async () => {
  await db.doc('users/admin').set(profile('ADMINISTRADOR'));
  await db.doc('producers/producer-test').set(producer());
  const request = (token: string, body = { status: 'verified', expectedRevision: 1 }) => fetch(`${baseUrl}/api/producers/producer-test/verification`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  assert.equal((await request('bad')).status, 401);
  assert.equal((await request('unverified-email')).status, 403);
  assert.equal((await request('unknown')).status, 403);
  assert.equal((await request('admin', { status: 'invalid', expectedRevision: 1 })).status, 400);
  const response = await request('admin');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).producer.verificationStatus, 'verified');
});

test('rules prevent public writes, privilege escalation and direct verification changes, including by admins', async () => {
  await db.doc('users/admin').set(profile('ADMINISTRADOR'));
  await db.doc('users/tech').set(profile('TECNICO'));
  await db.doc('producers/producer-test').set(producer());
  const anonymous = rules.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonymous, 'producers/producer-test')));
  await assertFails(setDoc(doc(anonymous, 'producers/fake'), producer()));
  const admin = rules.authenticatedContext('admin', { email_verified: true }).firestore();
  await assertFails(updateDoc(doc(admin, 'producers/producer-test'), { verificationStatus: 'verified', verifiedBySupervisor: true }));
  await assertFails(updateDoc(doc(admin, 'users/tech'), { role: 'ADMINISTRADOR' }));
  await assertFails(setDoc(doc(admin, 'whatsappSessions/fake'), { session: {} }));
  await assertFails(setDoc(doc(admin, 'auditLogs/fake'), { action: 'producer_verified' }));
  await assertSucceeds(updateDoc(doc(admin, 'producers/producer-test'), { fullName: 'Ana Revisada', cloudRevision: 2 }));
  const tech = rules.authenticatedContext('tech', { email_verified: true }).firestore();
  await assertSucceeds(updateDoc(doc(tech, 'producers/producer-test'), { fullName: 'Ana Técnica', cloudRevision: 3 }));
  await assertFails(updateDoc(doc(tech, 'producers/producer-test'), { registrationSource: 'admin' }));
});

test('rules require admin uploads verified and technician uploads unverified in assigned municipalities', async () => {
  await db.doc('users/admin').set(profile('ADMINISTRADOR'));
  await db.doc('users/tech').set(profile('TECNICO'));
  const admin = rules.authenticatedContext('admin', { email_verified: true }).firestore();
  const tech = rules.authenticatedContext('tech', { email_verified: true }).firestore();
  const uploaded = producer({ registrationSource: 'admin', verificationStatus: 'verified', verifiedBySupervisor: true, verifiedById: 'admin', verifiedByName: 'ADMINISTRADOR Test', verifiedAt: new Date().toISOString() });
  await assertSucceeds(setDoc(doc(admin, 'producers/admin-created'), { ...uploaded, id: 'admin-created' }));
  await assertFails(setDoc(doc(admin, 'producers/admin-unverified'), { ...uploaded, id: 'admin-unverified', verificationStatus: 'unverified', verifiedBySupervisor: false }));
  const surveyed = producer({ createdById: 'tech', registrationSource: 'technician' });
  await assertSucceeds(setDoc(doc(tech, 'producers/tech-created'), { ...surveyed, id: 'tech-created' }));
  await assertFails(setDoc(doc(tech, 'producers/tech-verified'), { ...surveyed, id: 'tech-verified', verificationStatus: 'verified', verifiedBySupervisor: true }));
  await assertFails(setDoc(doc(tech, 'producers/unassigned'), { ...surveyed, id: 'unassigned', municipality: 'San Vicente', municipalityId: 'san_vicente' }));
  await assertFails(setDoc(doc(tech, 'producers/fake-whatsapp'), { ...surveyed, id: 'fake-whatsapp', registrationSource: 'whatsapp' }));
});
