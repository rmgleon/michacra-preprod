import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { Timestamp, type Firestore, type DocumentReference } from 'firebase-admin/firestore';
import type { Producer } from '../src/db/schema';
import { advanceRegistration, normalize, type IncomingMessage, type RegistrationSession } from './registration';
import { producerVerificationStatus } from '../src/utils/producerVerification';

export interface WhatsAppConfig {
  appSecret: string;
  verifyToken: string;
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function validSignature(raw: Buffer, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

/** Consume every message in every change; delivery/read status notifications need no reply. */
export function extractMessages(payload: any, phoneNumberId: string): IncomingMessage[] {
  if (payload?.object !== 'whatsapp_business_account') return [];
  const messages: IncomingMessage[] = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (change.field !== 'messages' || change.value?.metadata?.phone_number_id !== phoneNumberId) continue;
      for (const message of Array.isArray(change.value.messages) ? change.value.messages : []) {
        if (message && typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 300 && typeof message.from === 'string' && /^\d{7,15}$/.test(message.from) && typeof message.type === 'string') messages.push(message);
      }
    }
  }
  return messages.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
}

export async function consumeMessage(db: Firestore, message: IncomingMessage, now = new Date().toISOString()) {
  const eventRef = db.doc(`whatsappEvents/${hash(message.id)}`);
  const sessionRef = db.doc(`whatsappSessions/${hash(message.from)}`);
  // This document is also the deterministic producer ID, so retries cannot create a second row.
  const producerId = `wa_${hash(message.from)}`;
  return db.runTransaction(async tx => {
    const event = await tx.get(eventRef);
    if (event.exists) return eventRef;
    const sessionSnap = await tx.get(sessionRef);
    const sessionData = sessionSnap.data();
    const session = sessionData?.session as RegistrationSession | null || null;
    let transition;
    if (normalize(message.text?.body || '') === 'estado') {
      const producer = await tx.get(db.doc(`producers/${producerId}`));
      transition = { session, reply: producer.exists
        ? `Tu ficha está ${producerVerificationStatus(producer.data()!) === 'verified' ? 'VERIFICADA' : 'SIN VERIFICAR. Un técnico o administrador debe revisarla'}.`
        : 'No hay una ficha enviada desde este número. Escribí REGISTRAR para comenzar o continuá con el dato solicitado.' };
    } else {
      transition = advanceRegistration(session, message, now);
    }
    if (transition.submission) {
      const draft = transition.submission;
      const producerRef = db.doc(`producers/${producerId}`);
      const dniRef = db.doc(`producerDocuments/${hash(draft.dni!)}`);
      const [existing, dniLock, matching, matchingLegacy] = await Promise.all([
        tx.get(producerRef), tx.get(dniRef),
        tx.get(db.collection('producers').where('normalizedDni', '==', draft.dni).limit(1)),
        tx.get(db.collection('producers').where('dni', '==', draft.dni).limit(1)),
      ]);
      if (existing.exists || dniLock.exists || !matching.empty || !matchingLegacy.empty) {
        transition.reply = 'No se creó otra ficha porque ya existe un registro relacionado. Contactá a un técnico para revisar o actualizar tus datos. Podés escribir ESTADO para consultar una ficha enviada desde este número.';
      } else {
        const producer: Producer = {
          ...draft as Producer, id: producerId, normalizedDni: draft.dni, phone: `+${message.from}`, whatsappPhone: message.from,
          addressReference: '', activities: draft.activities!.map((a, i) => ({ ...a, id: `${producerId}_act_${i}`, producerId })),
          syncStatus: 'synced', version: 1, cloudRevision: 1, createdAt: now, updatedAt: now,
          createdById: `whatsapp:${hash(message.from)}`, createdByName: 'Productor vía WhatsApp',
          registrationSource: 'whatsapp', verificationStatus: 'unverified', verifiedBySupervisor: false,
        };
        tx.create(producerRef, producer);
        tx.create(dniRef, { producerId, createdAt: now });
        tx.create(db.collection('auditLogs').doc(), { action: 'producer_self_registered', entity: 'producers', entityId: producerId, userId: producer.createdById, timestamp: now });
      }
    }
    tx.set(sessionRef, { session: transition.session, updatedAt: now, expiresAt: Timestamp.fromMillis(new Date(transition.session?.expiresAt || now).getTime()) });
    tx.create(eventRef, { to: message.from, reply: transition.reply, createdAt: now, deliveredAt: null, leaseUntil: 0, expiresAt: Timestamp.fromMillis(new Date(now).getTime() + 7 * 24 * 60 * 60 * 1000) });
    return eventRef;
  });
}

export async function deliverReply(db: Firestore, eventRef: DocumentReference, config: WhatsAppConfig, fetcher: typeof fetch = fetch): Promise<boolean> {
  const event = await db.runTransaction(async tx => {
    const snap = await tx.get(eventRef);
    const data = snap.data();
    if (!data || data.deliveredAt) return null;
    if (data.leaseUntil > Date.now()) throw new Error('Reply delivery already in progress');
    tx.update(eventRef, { leaseUntil: Date.now() + 60000 });
    return data;
  });
  if (!event) return true;
  try {
    const response = await fetcher(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: event.to, type: 'text', text: { preview_url: false, body: event.reply } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`WhatsApp delivery failed (${response.status})`);
    await eventRef.update({ deliveredAt: new Date().toISOString(), leaseUntil: 0 });
    return true;
  } catch (error) {
    await eventRef.update({ leaseUntil: 0 });
    throw error;
  }
}
