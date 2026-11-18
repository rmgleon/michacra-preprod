import { readFileSync } from 'node:fs';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const app = getApps().length ? getApp() : initializeApp({ projectId: process.env.GCLOUD_PROJECT || config.projectId });
export const firestore = getFirestore(app, process.env.FIRESTORE_DATABASE_ID || config.firestoreDatabaseId);
export const adminAuth = getAuth(app);
