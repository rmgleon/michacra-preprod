import type { Producer } from './schema';

const createdAt = '2026-11-18T19:00:00.000Z';

/** Fictional WhatsApp submissions for local review. Never enqueue these for cloud upload. */
export const DEMO_WHATSAPP_PRODUCERS: Producer[] = [
  {
    id: 'demo-wa-001', dni: 'DEMO-WA-001', fullName: 'Ana Gómez (Ejemplo)',
    establishmentName: 'Huerta La Esperanza', municipality: 'Oberá', colonyParaje: 'Picada Norte',
    surfaceHa: 2.5, lat: -27.48, lng: -55.12, isGeolocated: true, locationMethod: 'shared_link',
    locationCapturedBy: 'Productora vía WhatsApp', locationCapturedAt: createdAt,
    activities: [{ id: 'demo-wa-001-act', producerId: 'demo-wa-001', type: 'horticultura', title: 'Horticultura', surfaceHa: 1.5, specificData: {}, createdAt }],
  },
  {
    id: 'demo-wa-002', dni: 'DEMO-WA-002', fullName: 'Luis Pereira (Ejemplo)',
    establishmentName: 'Chacra Los Lapachos', municipality: 'Campo Viera', colonyParaje: 'Colonia Rural',
    surfaceHa: 12, lat: -27.35, lng: -55.05, isGeolocated: true, locationMethod: 'shared_link',
    locationCapturedBy: 'Productor vía WhatsApp', locationCapturedAt: createdAt,
    activities: [{ id: 'demo-wa-002-act', producerId: 'demo-wa-002', type: 'yerba_mate', title: 'Yerba mate', surfaceHa: 8, specificData: {}, createdAt }],
  },
  {
    id: 'demo-wa-003', dni: 'DEMO-WA-003', fullName: 'Marta Duarte (Ejemplo)',
    establishmentName: 'Vivero Las Orquídeas', municipality: 'San Vicente', colonyParaje: 'Paraje Rural',
    surfaceHa: 4, lat: 0, lng: 0, isGeolocated: false, locationMethod: 'not_georeferenced',
    activities: [{ id: 'demo-wa-003-act', producerId: 'demo-wa-003', type: 'fruticultura', title: 'Fruticultura', surfaceHa: 2, specificData: {}, createdAt }],
  },
].map((sample) => ({
  phone: '', isEstablishmentHead: true, producerType: 'pequeno_familiar', addressReference: '',
  tenureType: 'ocupacion_con_permiso', observations: 'Datos ficticios de ejemplo. Información declarada por el productor vía WhatsApp, pendiente de revisión.',
  syncStatus: 'synced', version: 1, createdAt, updatedAt: createdAt, lastSyncedAt: createdAt,
  createdById: `whatsapp:${sample.id}`, createdByName: sample.fullName,
  verificationStatus: 'unverified', verifiedBySupervisor: false, registrationSource: 'whatsapp', isDemo: true,
  ...sample,
} as Producer));
