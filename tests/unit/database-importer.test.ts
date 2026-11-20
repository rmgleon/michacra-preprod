import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import { afterEach, expect, it, vi } from 'vitest';

const { saveAndEnqueue } = vi.hoisted(() => ({ saveAndEnqueue: vi.fn(async () => 'operation-id') }));
vi.mock('../../src/services/syncEngine', () => ({ syncEngine: { saveAndEnqueue } }));
vi.mock('../../src/utils/fileImporterUtil', () => ({ parseAndImportProducerFile: vi.fn() }));

import { DatabaseImporter } from '../../src/components/admin/DatabaseImporter';
import { db } from '../../src/db/dexieDb';

afterEach(async () => {
  saveAndEnqueue.mockClear();
  await Promise.all(db.tables.map((table) => table.clear()));
});

it.each([false, true])('includes the canonical municipality in spreadsheet imports (existing=%s)', async (existing) => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  if (existing) await db.producers.put({ id: 'existing', dni: '30123456', municipality: 'Posadas', municipalityId: 'posadas', version: 2, cloudRevision: 3 } as any);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ DNI: '30123456', 'Nombre y Apellido': 'Ana Gómez', Municipio: 'Oberá', 'Nombre Chacra': 'La Esperanza' }]), 'Productores');
  const file = new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'productores.xlsx');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const complete = vi.fn();
  const click = async (text: string) => {
    const button = [...container.querySelectorAll('button')].find((element) => element.textContent?.includes(text));
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  try {
    await act(async () => root.render(React.createElement(DatabaseImporter, { currentUserId: 'admin', currentUserName: 'Admin', onImportComplete: complete, onGoToProducers: vi.fn(), onGoToMap: vi.fn() })));
    const input = container.querySelector('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      expect(container.textContent).toContain('Continuar a Vista Previa');
    });
    await click('Continuar a Vista Previa');
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      expect(container.textContent).toContain('Confirmar e Importar Productores');
    });
    if (existing) await click('B. Actualizar Existentes');
    await click('Confirmar e Importar Productores');
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      expect(complete).toHaveBeenCalled();
    });
    expect(saveAndEnqueue).toHaveBeenCalledWith('producers', expect.objectContaining({ municipality: 'Oberá', municipalityId: 'obera', ...(existing ? { cloudRevision: 3 } : { registrationSource: 'admin', verificationStatus: 'verified' }) }), existing ? 'update' : 'insert');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
