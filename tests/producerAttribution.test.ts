import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_WHATSAPP_PRODUCERS } from '../src/db/demoProducers';
import { isSelfRegisteredProducer, producerTechnicianName, producerRegistrationLabel, producerLocationAuthor } from '../src/utils/producerAttribution';

test('self registrations have no technician association, including after a technician verifies them', () => {
  const sample = DEMO_WHATSAPP_PRODUCERS[0];
  assert.equal(isSelfRegisteredProducer(sample), true);
  assert.equal(producerTechnicianName(sample), null);
  const reviewed = { ...sample, verificationStatus: 'verified' as const, verifiedBySupervisor: true,
    verifiedById: 'technician-1', verifiedByName: 'Técnico de prueba' };
  assert.equal(producerTechnicianName(reviewed), null);
  assert.equal(producerRegistrationLabel(reviewed), 'Autoregistro por WhatsApp');
  // The WhatsApp submitter remains recognizable on records predating registrationSource.
  assert.equal(producerTechnicianName({ ...reviewed, registrationSource: undefined }), null);
});

test('technician attribution applies to surveys, and never to admin uploads or WhatsApp examples', () => {
  const sample = DEMO_WHATSAPP_PRODUCERS[0];
  const surveyed = { ...sample, createdById: 'tech-1', createdByName: 'Técnico de prueba', registrationSource: 'technician' as const };
  assert.equal(producerTechnicianName(surveyed), 'Técnico de prueba');
  assert.equal(producerTechnicianName({ ...surveyed, registrationSource: undefined }), 'Técnico de prueba');
  assert.equal(producerTechnicianName({ ...surveyed, registrationSource: 'admin' }), null);
  assert.equal(new Set(DEMO_WHATSAPP_PRODUCERS.map(p => p.id)).size, 3);
  for (const producer of DEMO_WHATSAPP_PRODUCERS) {
    assert.equal(producer.isDemo, true);
    assert.equal(producer.verificationStatus, 'unverified');
    assert.equal(producerTechnicianName(producer), null);
    assert.match(producer.fullName, /Ejemplo/);
  }
  assert.equal(producerLocationAuthor(DEMO_WHATSAPP_PRODUCERS[2]), 'Sin captura de ubicación');
});
