import { auth } from './firestoreSync';
import { db } from '../db/dexieDb';
import type { Producer } from '../db/schema';
import { AuthService } from './authService';
import { canVerifyProducers } from '../utils/producerVerification';
import { MISIONES_MUNICIPALITIES } from '../db/misionesCatalog';

export async function setProducerVerification(producer: Producer, status: 'verified' | 'unverified'): Promise<Producer> {
  if (producer.isDemo) {
    const user = AuthService.getStoredSession();
    if (!user || !canVerifyProducers(user)) throw new Error('Ingresá como técnico o administrador para probar la verificación.');
    return db.transaction('rw', db.producers, db.auditLogs, async () => {
      const local = await db.producers.get(producer.id);
      if (!local?.isDemo) throw new Error('No se encontró el registro de ejemplo.');
      const municipality = MISIONES_MUNICIPALITIES.find(m => m.name === local.municipality || m.id === local.municipality);
      if (user.role === 'TECNICO' && !user.assignedMunicipalities?.some(m => m === local.municipality || m === municipality?.id)) {
        throw new Error('El productor no pertenece a tus municipios asignados.');
      }
      const now = new Date().toISOString();
      const verified = status === 'verified';
      const updated: Producer = { ...local, verificationStatus: status, verifiedBySupervisor: verified,
        verifiedById: verified ? user.id : '', verifiedByName: verified ? user.fullName : '', verifiedAt: verified ? now : '',
        updatedAt: now, lastSyncedAt: now, version: local.version + 1, syncStatus: 'synced' };
      await db.producers.put(updated);
      await db.auditLogs.add({ id: crypto.randomUUID(), userId: user.id, userName: user.fullName, userRole: user.role,
        action: verified ? 'DEMO_PRODUCER_VERIFIED' : 'DEMO_PRODUCER_UNVERIFIED', entity: 'producers', entityId: producer.id,
        details: 'Verificación de datos ficticios guardada solo en este dispositivo.', device: 'Ejemplo local', timestamp: now });
      return updated;
    });
  }
  if (producer.syncStatus !== 'synced') {
    throw new Error('Sincronizá los cambios del productor antes de verificarlo.');
  }
  await auth.authStateReady();
  if (!auth.currentUser) throw new Error('Ingresá con tu cuenta de Google para verificar productores.');
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`/api/producers/${encodeURIComponent(producer.id)}/verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status, expectedRevision: producer.cloudRevision || 0 }),
  });
  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    throw new Error('El servicio de verificación no está disponible. Contactá al administrador.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo guardar la verificación.');
  // A concurrent local edit must not be replaced by the server response.
  await db.transaction('rw', db.producers, async () => {
    const local = await db.producers.get(producer.id);
    if (!local || (local.syncStatus === 'synced' && local.updatedAt === producer.updatedAt)) {
      await db.producers.put(data.producer);
    } else {
      await db.producers.update(producer.id, { syncStatus: 'conflict', syncConflict: {
        cloudRecord: data.producer, detectedAt: new Date().toISOString(),
      } });
    }
  });
  return data.producer;
}
