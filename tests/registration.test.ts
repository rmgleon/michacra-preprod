import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { advanceRegistration, type RegistrationSession, type IncomingMessage } from '../server/registration';
import { extractMessages, validSignature } from '../server/whatsapp';
import { adminVerification, producerVerificationStatus } from '../src/utils/producerVerification';

const now = '2026-11-18T19:00:00.000Z';
const message = (body: string): IncomingMessage => ({ id: 'test', from: '5493755123456', type: 'text', text: { body } });

test('producer completes the Spanish flow, reviews details and explicitly confirms', () => {
  let session: RegistrationSession | null = null;
  for (const answer of ['REGISTRAR', '30.123.456', 'Ana Gómez', 'Oberá', 'La Esperanza', 'Picada Norte', '1', 'SÍ', '2,5', '1,2', '1', 'OMITIR']) {
    const result = advanceRegistration(session, message(answer), now);
    assert.equal(result.submission, undefined);
    assert.ok(result.session, `${answer}: ${result.reply}`);
    session = result.session;
  }
  assert.ok(session);
  assert.equal(session.step, 'confirm');
  const review = advanceRegistration(session, message('sí'), now);
  assert.equal(review.submission, undefined);
  assert.match(review.reply, /Ana Gómez/);
  const submitted = advanceRegistration(session, message('CONFIRMAR'), now);
  assert.equal(submitted.session, null);
  assert.ok(submitted.submission);
  assert.ok(submitted.submission.activities);
  assert.equal(submitted.submission.dni, '30123456');
  assert.equal(submitted.submission.surfaceHa, 2.5);
  assert.equal(submitted.submission.activities.length, 2);
  assert.equal(submitted.submission.isGeolocated, false);
  assert.equal(submitted.submission.lat, 0);
  assert.match(submitted.reply, /SIN VERIFICAR/);
});

test('invalid input and unsupported messages do not advance or corrupt the draft', () => {
  const started = advanceRegistration(null, message('registrar'), now).session!;
  for (const invalid of ['abc30123456', '00000000', '1234', '123456789', 'CONFIRMAR']) {
    const result = advanceRegistration(started, message(invalid), now);
    assert.equal(result.session!.step, 'dni');
    assert.deepEqual(result.session!.draft, {});
  }
  const result = advanceRegistration(started, { ...message(''), type: 'audio' }, now);
  assert.equal(result.session!.step, 'dni');
  const surfaceSession: RegistrationSession = { ...started, step: 'surfaceHa', draft: {} };
  for (const invalid of ['-1', '0', 'Infinity', '', '1000001', '2ha']) {
    assert.equal(advanceRegistration(surfaceSession, message(invalid), now).session!.step, 'surfaceHa');
  }
});

test('native WhatsApp location is optional and must be finite and within Misiones bounds', () => {
  const session: RegistrationSession = { step: 'location', draft: {}, expiresAt: '2026-11-19T19:00:00Z' };
  const incoming = { ...message(''), type: 'location', location: { latitude: -27.48, longitude: -55.12 } };
  const result = advanceRegistration(session, incoming, now);
  assert.equal(result.session!.step, 'confirm');
  assert.equal(result.session!.draft.isGeolocated, true);
  for (const latitude of [0, -40, NaN, Infinity]) {
    const invalid = advanceRegistration(session, { ...incoming, location: { ...incoming.location, latitude } }, now);
    assert.equal(invalid.session!.step, 'location');
  }
});

test('cancel and expiry discard drafts; restart clears prior answers', () => {
  const started = advanceRegistration(null, message('registrar'), now).session!;
  const populated = { ...started, draft: { dni: '30123456' } };
  assert.equal(advanceRegistration(populated, message('CANCELAR'), now).session, null);
  assert.deepEqual(advanceRegistration(populated, message('REINICIAR'), now).session!.draft, {});
  assert.equal(advanceRegistration(populated, message('Ana'), '2026-11-20T00:00:00Z').session, null);
});

test('webhook validates the original bytes using HMAC and ignores other phone IDs/status callbacks', () => {
  const raw = Buffer.from('{"test":true}');
  const signature = `sha256=${createHmac('sha256', 'secret').update(raw).digest('hex')}`;
  assert.equal(validSignature(raw, signature, 'secret'), true);
  assert.equal(validSignature(Buffer.from('{ "test":true}'), signature, 'secret'), false);
  assert.equal(validSignature(raw, 'sha256=bad', 'secret'), false);
  assert.equal(validSignature(raw, undefined, 'secret'), false);
  assert.equal(validSignature(raw, signature, ''), false);
  const change = (id: string, messages?: any[]) => ({ field: 'messages', value: { metadata: { phone_number_id: id }, messages, statuses: [{ status: 'read' }] } });
  const payload = { object: 'whatsapp_business_account', entry: [
    { changes: [change('ours', [message('a')]), change('another', [message('ignore')])] },
    { changes: [change('ours'), change('ours', [{ ...message('b'), id: 'test-b' }])] },
  ] };
  assert.equal(extractMessages(payload, 'ours').length, 2);
});

test('verification supports legacy records and administrator uploads start verified', () => {
  assert.equal(producerVerificationStatus({ verifiedBySupervisor: true }), 'verified');
  assert.equal(producerVerificationStatus({ verifiedBySupervisor: false }), 'unverified');
  assert.equal(producerVerificationStatus({ verificationStatus: 'unverified', verifiedBySupervisor: true }), 'unverified');
  assert.equal(adminVerification('admin', 'Admin', now).verificationStatus, 'verified');
});
