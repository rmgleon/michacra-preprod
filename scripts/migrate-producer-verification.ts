import 'dotenv/config';
import { parseArgs } from 'node:util';
import { firestore } from '../server/firebase';
import { producerVerificationStatus } from '../src/utils/producerVerification';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
let updated = 0;
for (const snapshot of (await firestore.collection('producers').get()).docs) {
  const changed = await firestore.runTransaction(async tx => {
    const producer = (await tx.get(snapshot.ref)).data()!;
    const normalizedDni = String(producer.dni || '').replace(/\D/g, '');
    const verificationStatus = producerVerificationStatus(producer);
    if (producer.normalizedDni === normalizedDni && producer.verificationStatus === verificationStatus && producer.verifiedBySupervisor === (verificationStatus === 'verified')) return false;
    if (values.apply) tx.update(snapshot.ref, {
      normalizedDni, verificationStatus, verifiedBySupervisor: verificationStatus === 'verified',
      cloudRevision: Number(producer.cloudRevision || 0) + 1, version: Number(producer.version || 1) + 1,
      updatedAt: new Date().toISOString(), lastSyncedAt: new Date().toISOString(),
    });
    return true;
  });
  if (changed) updated++;
}
console.info(`${updated} producers ${values.apply ? 'updated' : 'would be updated (preview only; use --apply to save)'}. Existing verification is preserved.`);
