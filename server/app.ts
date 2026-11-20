import express from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { ApiError, reviewProducer } from './verification';
import { consumeMessage, deliverReply, extractMessages, validSignature, type WhatsAppConfig } from './whatsapp';

export function createApi({ db, auth, whatsapp, fetcher = fetch }: {
  db: Firestore; auth: Auth; whatsapp: WhatsAppConfig; fetcher?: typeof fetch;
}) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/whatsapp/webhook', (req, res) => {
    if (whatsapp.verifyToken && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === whatsapp.verifyToken && typeof req.query['hub.challenge'] === 'string') {
      res.type('text/plain').send(req.query['hub.challenge']);
    } else res.sendStatus(403);
  });
  // Signature verification must use the original bytes, before JSON parsing.
  app.post('/api/whatsapp/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !validSignature(req.body, req.get('x-hub-signature-256'), whatsapp.appSecret)) {
      res.sendStatus(401); return;
    }
    let payload;
    try { payload = JSON.parse(req.body.toString('utf8')); }
    catch { res.sendStatus(400); return; }
    try {
      for (const message of extractMessages(payload, whatsapp.phoneNumberId)) {
        // Avoid resurrecting expired sessions from old redeliveries.
        const age = Date.now() - Number(message.timestamp) * 1000;
        if (!Number.isFinite(age) || age > 24 * 60 * 60 * 1000 || age < -5 * 60 * 1000) continue;
        const event = await consumeMessage(db, message);
        await deliverReply(db, event, whatsapp, fetcher);
      }
      res.sendStatus(200);
    } catch (error) {
      // Do not acknowledge failed storage/delivery; Meta can retry the stored event.
      console.error('WhatsApp processing failed:', error instanceof Error ? error.message : 'unknown');
      res.sendStatus(503);
    }
  });

  app.post('/api/producers/:producerId/verification', express.json({ limit: '8kb' }), async (req, res) => {
    try {
      const token = req.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new ApiError(401, 'Iniciá sesión con tu cuenta de Google.');
      let identity;
      try { identity = await auth.verifyIdToken(token, true); }
      catch { throw new ApiError(401, 'La sesión venció o fue revocada. Volvé a ingresar.'); }
      if (!identity.email_verified) throw new ApiError(403, 'Verificá el correo de tu cuenta.');
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(req.params.producerId)) throw new ApiError(400, 'Identificador inválido.');
      const producer = await reviewProducer(db, identity.uid, req.params.producerId, req.body?.status, req.body?.expectedRevision);
      res.json({ producer });
    } catch (error) {
      if (error instanceof ApiError) res.status(error.status).json({ error: error.message });
      else {
        console.error('Producer verification failed:', error instanceof Error ? error.message : 'unknown');
        res.status(500).json({ error: 'No se pudo guardar la verificación. Intentá nuevamente.' });
      }
    }
  });
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status === 413 ? 413 : 400).json({ error: 'Solicitud inválida.' });
  });
  return app;
}
