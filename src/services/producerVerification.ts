import { auth } from './firestoreSync';
import { db } from '../db/dexieDb';
import type { Producer } from '../db/schema';

export async function setProducerVerification(producer: Producer, status: 'verified' | 'unverified'): Promise<Producer> {
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
