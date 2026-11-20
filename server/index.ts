import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApi } from './app';
import { firestore, adminAuth } from './firebase';

const required = ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_GRAPH_VERSION'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing server configuration: ${key}`);
}
if (!/^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_VERSION!) || !/^\d+$/.test(process.env.WHATSAPP_PHONE_NUMBER_ID!)) {
  throw new Error('Invalid WhatsApp API version or phone number ID');
}
const app = createApi({ db: firestore, auth: adminAuth, whatsapp: {
  appSecret: process.env.WHATSAPP_APP_SECRET!, verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN!, phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!, graphVersion: process.env.WHATSAPP_GRAPH_VERSION!,
} });
if (process.env.NODE_ENV === 'production') {
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  app.use(express.static(dist));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) { res.sendStatus(404); return; }
    res.sendFile(`${dist}/index.html`);
  });
}
const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.info(`SIP API listening on port ${port}`));
