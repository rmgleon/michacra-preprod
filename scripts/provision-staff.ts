import 'dotenv/config';
import { parseArgs } from 'node:util';
import { firestore, adminAuth } from '../server/firebase';
import { MISIONES_MUNICIPALITIES } from '../src/db/misionesCatalog';

const { values } = parseArgs({ options: {
  email: { type: 'string' }, role: { type: 'string' }, municipalities: { type: 'string' }, apply: { type: 'boolean', default: false },
} });
if (!values.email || !values.role || !['SUPERADMIN', 'ADMINISTRADOR', 'TECNICO', 'DIRECTOR', 'SUPERVISOR'].includes(values.role)) {
  throw new Error('Usage: npm run staff:provision -- --email person@example.com --role TECNICO --municipalities obera,campo_viera [--apply]');
}
const assignedMunicipalities = values.municipalities?.split(',').map(id => id.trim()).filter(Boolean) || [];
if (assignedMunicipalities.some(id => !MISIONES_MUNICIPALITIES.some(m => m.id === id)) || (values.role === 'TECNICO' && !assignedMunicipalities.length)) {
  throw new Error('Provide valid municipality IDs. Technicians need at least one assigned municipality.');
}
const identity = await adminAuth.getUserByEmail(values.email);
if (identity.disabled || !identity.emailVerified) throw new Error('The Firebase Auth account must be enabled and have a verified email. Sign in with Google first.');
console.info({ uid: identity.uid, email: identity.email, role: values.role, assignedMunicipalities, apply: values.apply });
if (values.apply) {
  await firestore.runTransaction(async tx => {
    const ref = firestore.doc(`users/${identity.uid}`);
    const existing = (await tx.get(ref)).data();
    const now = new Date().toISOString();
    tx.set(ref, {
      ...existing, id: identity.uid, email: identity.email, fullName: identity.displayName || existing?.fullName || identity.email,
      dni: existing?.dni || '', role: values.role, assignedMunicipalities, active: true, approvalStatus: 'approved',
      authProvider: 'google', emailVerified: true, createdAt: existing?.createdAt || now, updatedAt: now,
    });
    tx.create(firestore.collection('auditLogs').doc(), {
      action: 'staff_provisioned', entity: 'users', entityId: identity.uid,
      userId: 'trusted-provisioning-script', role: values.role, previousRole: existing?.role || '', timestamp: now,
    });
  });
  console.info('Staff profile saved. Sign in with Google again to load it.');
} else console.info('Preview only. Add --apply to save this server profile.');
