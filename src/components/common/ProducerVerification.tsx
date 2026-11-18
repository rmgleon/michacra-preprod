import React, { useState } from 'react';
import type { Producer, UserProfile } from '../../db/schema';
import { canVerifyProducers, producerVerificationStatus } from '../../utils/producerVerification';
import { setProducerVerification } from '../../services/producerVerification';

export function ProducerVerificationBadge({ producer }: { producer: Producer }) {
  const verified = producerVerificationStatus(producer) === 'verified';
  return <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${verified ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
    {verified ? 'Verificado' : 'Sin verificar'}
  </span>;
}

export function ProducerVerification({ producer, currentUser, onChanged }: {
  producer: Producer; currentUser?: UserProfile | null; onChanged: (producer: Producer) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const verified = producerVerificationStatus(producer) === 'verified';
  return <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
    <div className="flex items-center justify-between gap-3">
      <div className="space-y-1">
        <ProducerVerificationBadge producer={producer} />
        <p className="text-slate-600">{producer.registrationSource === 'whatsapp' ? 'Registrado por el productor vía WhatsApp' : `Cargado por ${producer.createdByName}`}</p>
        {verified && producer.verifiedByName && <p className="text-slate-500">Verificado por {producer.verifiedByName}{producer.verifiedAt ? ` el ${new Date(producer.verifiedAt).toLocaleDateString('es-AR')}` : ''}</p>}
      </div>
      {canVerifyProducers(currentUser) && <button type="button" disabled={busy} className="px-3 py-2 rounded-xl bg-[#27865A] text-white font-bold disabled:opacity-50" onClick={async () => {
        setBusy(true); setError('');
        try { onChanged(await setProducerVerification(producer, verified ? 'unverified' : 'verified')); }
        catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar la verificación.'); }
        finally { setBusy(false); }
      }}>{busy ? 'Guardando…' : verified ? 'Marcar sin verificar' : 'Verificar productor'}</button>}
    </div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </div>;
}
