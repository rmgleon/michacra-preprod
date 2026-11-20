import type { Producer } from '../db/schema';

export function isSelfRegisteredProducer(producer: Producer): boolean {
  return producer.registrationSource === 'whatsapp' || producer.createdById?.startsWith('whatsapp:') === true;
}

/** The submitter and the reviewer are separate identities; a review never assigns a technician. */
export function producerTechnicianName(producer: Producer): string | null {
  if (isSelfRegisteredProducer(producer) || producer.registrationSource === 'admin' || producer.importBatchId || producer.importSourceFileName) return null;
  return producer.createdByName || null;
}

export function producerRegistrationLabel(producer: Producer): string {
  if (isSelfRegisteredProducer(producer)) return 'Autoregistro por WhatsApp';
  return `${producerTechnicianName(producer) ? 'Relevado' : 'Cargado'} por ${producer.createdByName || 'Usuario no registrado'}`;
}

export function producerLocationAuthor(producer: Producer): string {
  if (producer.isGeolocated === false || producer.locationMethod === 'not_georeferenced') return 'Sin captura de ubicación';
  return producer.locationCapturedBy || (isSelfRegisteredProducer(producer) ? 'Productor vía WhatsApp' : producer.createdByName || 'No registrado');
}
