import { useState, type ChangeEvent } from 'react';
import type { CharacterDto, ImportCharacterCardRequest } from '@roleagent/shared';
import { importCharacterCard } from '../api';

interface CharacterImportProps {
  onImported: (character: CharacterDto) => void;
}

async function parsePngChara(file: File): Promise<unknown> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // PNG signature: 137 80 78 71 13 10 26 10
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== sig[i]) {
      throw new Error('not a valid PNG file');
    }
  }

  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    offset += 8;

    if (type === 'tEXt') {
      const data = bytes.subarray(offset, offset + length);
      const nullPos = data.indexOf(0);
      if (nullPos > 0) {
        const keyword = new TextDecoder().decode(data.subarray(0, nullPos));
        if (keyword === 'chara') {
          const b64 = new TextDecoder().decode(data.subarray(nullPos + 1));
          const json = atob(b64);
          return JSON.parse(json);
        }
      }
    }

    // Move past data + CRC (4 bytes)
    offset += length + 4;
  }

  throw new Error('no chara chunk found in PNG (not a SillyTavern character card)');
}

function mapCardToImport(card: unknown): ImportCharacterCardRequest {
  if (!card || typeof card !== 'object') {
    throw new Error('invalid card: expected a JSON object');
  }
  // Support v2 (data nested) and v1 (flat)
  const root = (card as { data?: unknown }).data ?? card;
  if (!root || typeof root !== 'object') {
    throw new Error('invalid card: expected an object');
  }
  const r = root as Record<string, unknown>;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) {
    throw new Error('card missing required field: name');
  }

  const getStr = (key: string): string | undefined => {
    const val = r[key];
    return typeof val === 'string' ? val : undefined;
  };

  return {
    name,
    description: getStr('description'),
    persona: getStr('persona'),
    scenario: getStr('scenario'),
    firstMessage: getStr('first_mes') ?? getStr('firstMessage'),
    messageExample: getStr('mes_example') ?? getStr('messageExample'),
    systemPrompt: getStr('system_prompt') ?? getStr('systemPrompt'),
    rawCardJson: JSON.stringify(card),
  };
}

export function CharacterImport({ onImported }: CharacterImportProps) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setSuccess(null);
    setImporting(true);

    try {
      let card: unknown;
      if (file.name.toLowerCase().endsWith('.png')) {
        card = await parsePngChara(file);
      } else {
        const text = await file.text();
        card = JSON.parse(text);
      }

      const req = mapCardToImport(card);
      const created = await importCharacterCard(req);
      setSuccess(`Imported: ${created.name}`);
      onImported(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  return (
    <section className="import-panel">
      <div className="section-heading">
        <p className="eyebrow">Card import</p>
        <h2>Import Character</h2>
      </div>
      <label className={`import-dropzone${importing ? ' import-dropzone--busy' : ''}`}>
        <input
          type="file"
          accept=".json,.png"
          onChange={handleFile}
          disabled={importing}
        />
        <span>{importing ? 'Importing...' : 'Choose JSON or PNG card'}</span>
        <small>SillyTavern character cards are supported.</small>
      </label>
      {error !== null && <p className="notice notice--error">{error}</p>}
      {success !== null && <p className="notice notice--success">{success}</p>}
    </section>
  );
}
