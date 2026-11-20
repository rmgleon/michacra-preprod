import type { Producer, ProducerType } from '../src/db/schema';
import { MISIONES_MUNICIPALITIES, PRODUCTIVE_ACTIVITIES_CATALOG } from '../src/db/misionesCatalog';

export interface IncomingMessage {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
  location?: { latitude: number; longitude: number };
}

const producerTypes: [ProducerType, string][] = [
  ['pequeno_familiar', 'Pequeño productor familiar'], ['mediano_comercial', 'Mediano comercial'],
  ['cooperativista', 'Cooperativista'], ['empresa_agropecuaria', 'Empresa agropecuaria'],
  ['comunidad_originaria', 'Comunidad originaria'],
];
const tenures: [Producer['tenureType'], string][] = [
  ['propiedad_con_titulo', 'Propiedad con título'], ['ocupacion_con_permiso', 'Ocupación con permiso'],
  ['arrendamiento', 'Arrendamiento'], ['fiscal_en_tramite', 'Fiscal en trámite'], ['comunitaria', 'Comunitaria'],
];
const steps = ['dni', 'fullName', 'municipality', 'establishmentName', 'colonyParaje', 'producerType',
  'isEstablishmentHead', 'surfaceHa', 'activities', 'tenureType', 'location', 'confirm'] as const;
type Step = typeof steps[number];
export interface RegistrationSession {
  step: Step;
  draft: Partial<Producer>;
  expiresAt: string;
}
export interface RegistrationTransition {
  session: RegistrationSession | null;
  reply: string;
  submission?: Partial<Producer>;
}
export const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const menu = (items: string[]) => items.map((item, index) => `${index + 1}. ${item}`).join('\n');

function prompt(step: Step, draft: Partial<Producer>): string {
  switch (step) {
    case 'dni': return 'Ingresá tu DNI (7 u 8 dígitos, sin letras).';
    case 'fullName': return '¿Cuál es tu nombre y apellido?';
    case 'municipality': return `¿En qué municipio está tu establecimiento? Respondé con el nombre o número:\n${menu(MISIONES_MUNICIPALITIES.map(m => m.name))}`;
    case 'establishmentName': return '¿Cómo se llama tu chacra o establecimiento?';
    case 'colonyParaje': return '¿En qué colonia o paraje está?';
    case 'producerType': return `Seleccioná tu tipo de productor:\n${menu(producerTypes.map(t => t[1]))}`;
    case 'isEstablishmentHead': return '¿Sos titular o responsable del establecimiento? Respondé SÍ o NO.';
    case 'surfaceHa': return '¿Cuántas hectáreas tiene el establecimiento? Podés usar decimales (ejemplo: 2,5).';
    case 'activities': return `¿Qué producís? Elegí uno o varios números separados por comas:\n${menu(PRODUCTIVE_ACTIVITIES_CATALOG.map(a => a.name))}`;
    case 'tenureType': return `¿Cuál es la tenencia de la tierra?\n${menu(tenures.map(t => t[1]))}`;
    case 'location': return 'Compartí la ubicación de tu establecimiento con el botón de ubicación de WhatsApp, o escribí OMITIR para registrarte sin coordenadas.';
    case 'confirm': return `Revisá tus datos:\nNombre: ${draft.fullName}\nDNI: ${draft.dni}\nMunicipio: ${draft.municipality}\nEstablecimiento: ${draft.establishmentName}\nColonia/paraje: ${draft.colonyParaje}\nTipo: ${producerTypes.find(t => t[0] === draft.producerType)?.[1]}\nResponsable: ${draft.isEstablishmentHead ? 'Sí' : 'No'}\nSuperficie: ${draft.surfaceHa} ha\nProducción: ${draft.activities?.map(a => a.title).join(', ')}\nTenencia: ${tenures.find(t => t[0] === draft.tenureType)?.[1]}\nUbicación: ${draft.isGeolocated ? `${draft.lat}, ${draft.lng}` : 'Sin coordenadas'}\n\nEscribí CONFIRMAR para enviar. Tu registro quedará SIN VERIFICAR hasta que un técnico o administrador lo revise. Para corregir datos escribí REINICIAR; para salir, CANCELAR.`;
  }
}

function choose<T>(text: string, items: T[], label: (item: T) => string): T | undefined {
  if (/^\d+$/.test(text)) return items[Number(text) - 1];
  return items.find(item => normalize(label(item)) === normalize(text));
}

/** Pure conversation logic; Firestore owns sessions, deduplication and submission. */
export function advanceRegistration(session: RegistrationSession | null, message: IncomingMessage, now: string): RegistrationTransition {
  const text = message.type === 'text' ? (message.text?.body || '').trim() : '';
  const command = normalize(text);
  const fresh = !session || new Date(session.expiresAt).getTime() <= new Date(now).getTime();
  if (command === 'cancelar') return { session: null, reply: 'Registro en curso cancelado. Escribí REGISTRAR para comenzar de nuevo.' };
  if (['registrar', 'reiniciar'].includes(command)) {
    return { session: { step: 'dni', draft: {}, expiresAt: new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString() }, reply: prompt('dni', {}) };
  }
  if (fresh) return { session: null, reply: 'Bienvenido a MiChacra - Ministerio de Agro y la Producción. Podés registrar tu actividad productiva por este chat. Al escribir REGISTRAR aceptás enviar tus datos al Ministerio para su registro y revisión por técnicos y administradores. Escribí ESTADO para consultar una ficha enviada desde este número. Podés CANCELAR en cualquier momento.' };
  const draft = { ...session.draft };
  const current = session.step;
  let valid = true;
  if (text.length > 500) valid = false;
  else switch (current) {
    case 'dni': {
      const dni = text.replace(/[.\s]/g, '');
      valid = /^\d{7,8}$/.test(dni) && !/^0+$/.test(dni);
      if (valid) draft.dni = dni;
      break;
    }
    case 'fullName': case 'establishmentName': case 'colonyParaje':
      valid = text.length >= 2 && text.length <= 120;
      if (valid) draft[current] = text;
      break;
    case 'municipality': {
      const municipality = choose(text, MISIONES_MUNICIPALITIES, m => m.name) || MISIONES_MUNICIPALITIES.find(m => m.id === command || (command === 'posadas' && m.id === 'posadas'));
      valid = Boolean(municipality);
      if (municipality) draft.municipality = municipality.name;
      break;
    }
    case 'producerType': {
      const type = choose(text, producerTypes, t => t[1]);
      valid = Boolean(type);
      if (type) draft.producerType = type[0];
      break;
    }
    case 'isEstablishmentHead':
      valid = ['si', 'no'].includes(command);
      if (valid) draft.isEstablishmentHead = command === 'si';
      break;
    case 'surfaceHa': {
      const surface = Number(text.replace(',', '.'));
      valid = /^\d+(?:[.,]\d{1,4})?$/.test(text) && surface > 0 && surface <= 1000000;
      if (valid) draft.surfaceHa = surface;
      break;
    }
    case 'activities': {
      const selected = [...new Set(text.split(',').map(v => v.trim()))].map(v => choose(v, PRODUCTIVE_ACTIVITIES_CATALOG, a => a.name));
      valid = selected.length > 0 && selected.length <= PRODUCTIVE_ACTIVITIES_CATALOG.length && selected.every(Boolean);
      if (valid) draft.activities = selected.map(a => ({ id: '', producerId: '', type: a!.type, title: a!.name, surfaceHa: 0, specificData: {}, createdAt: now }));
      break;
    }
    case 'tenureType': {
      const tenure = choose(text, tenures, t => t[1]);
      valid = Boolean(tenure);
      if (tenure) draft.tenureType = tenure[0];
      break;
    }
    case 'location': {
      const location = message.type === 'location' ? message.location : null;
      if (location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude) && location.latitude >= -28.2 && location.latitude <= -25.3 && location.longitude >= -56.1 && location.longitude <= -53.5) {
        Object.assign(draft, { lat: location.latitude, lng: location.longitude, isGeolocated: true, locationMethod: 'shared_link', locationCapturedAt: now, locationCapturedBy: 'Productor vía WhatsApp' });
      } else if (command === 'omitir') {
        Object.assign(draft, { lat: 0, lng: 0, isGeolocated: false, locationMethod: 'not_georeferenced' });
      } else valid = false;
      break;
    }
    case 'confirm':
      if (command === 'confirmar') return { session: null, submission: draft, reply: 'Tu registro fue recibido y quedó SIN VERIFICAR. Un técnico o administrador podrá verificarlo. Escribí ESTADO cuando quieras consultar su verificación.' };
      valid = false;
      break;
  }
  if (!valid) return { session, reply: `No pudimos interpretar ese dato.\n${prompt(current, draft)}` };
  const next = steps[steps.indexOf(current) + 1];
  const updated = { ...session, step: next, draft };
  return { session: updated, reply: prompt(next, draft) };
}
