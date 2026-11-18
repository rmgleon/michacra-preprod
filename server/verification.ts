import type { Firestore } from 'firebase-admin/firestore';
import { MISIONES_MUNICIPALITIES } from '../src/db/misionesCatalog';
import { normalize } from './registration';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function reviewProducer(db: Firestore, uid: string, producerId: string, status: unknown, expectedRevision: unknown) {
  if (typeof status !== 'string' || !['verified', 'unverified'].includes(status) || !Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0) {
    throw new ApiError(400, 'Estado o revisión inválidos.');
  }
  return db.runTransaction(async tx => {
    const [accountSnap, producerSnap] = await Promise.all([
      tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`producers/${producerId}`)),
    ]);
    const account = accountSnap.data();
    if (!account || account.active !== true || account.approvalStatus !== 'approved' || !['SUPERADMIN', 'ADMINISTRADOR', 'TECNICO'].includes(account.role)) {
      throw new ApiError(403, 'Tu cuenta no está habilitada para verificar productores.');
    }
    if (!producerSnap.exists) throw new ApiError(404, 'No se encontró el productor.');
    const producer = producerSnap.data()!;
    if (account.role === 'TECNICO') {
      const municipality = MISIONES_MUNICIPALITIES.find(m => normalize(m.name) === normalize(producer.municipality) || m.id === producer.municipality);
      const assigned: string[] = Array.isArray(account.assignedMunicipalities) ? account.assignedMunicipalities : [];
      if (!assigned.some(value => normalize(value) === normalize(producer.municipality) || value === municipality?.id)) {
        throw new ApiError(403, 'El productor no pertenece a tus municipios asignados.');
      }
    }
    if (Number(producer.cloudRevision || 0) !== expectedRevision) throw new ApiError(409, 'La ficha cambió en otro dispositivo. Sincronizá y volvé a revisarla.');
    const now = new Date().toISOString();
    const verified = status === 'verified';
    const updated = {
      ...producer, verificationStatus: status, verifiedBySupervisor: verified,
      verifiedById: verified ? uid : '', verifiedByName: verified ? account.fullName : '', verifiedAt: verified ? now : '',
      cloudRevision: Number(producer.cloudRevision || 0) + 1, version: Number(producer.version || 1) + 1,
      updatedAt: now, lastSyncedAt: now, syncStatus: 'synced',
    };
    tx.set(producerSnap.ref, updated);
    tx.create(db.collection('auditLogs').doc(), {
      userId: uid, userName: account.fullName, userRole: account.role, action: verified ? 'producer_verified' : 'producer_unverified',
      entity: 'producers', entityId: producerId, timestamp: now,
      previousStatus: producer.verificationStatus || (producer.verifiedBySupervisor ? 'verified' : 'unverified'), status,
    });
    return updated;
  });
}
