import { useState, type ChangeEvent } from 'react';
import type { CharacterDto, ImportCharacterCardRequest } from '@roleagent/shared';
import { importCharacterCard } from '../api';

interface CharacterImportProps {
  onImported: (character: CharacterDto) => void;
}

function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder('utf-8').decode(bytes);
}

function parseCardJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('角色卡 JSON 格式无效');
  }
}

async function parsePngChara(file: File): Promise<unknown> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // PNG signature: 137 80 78 71 13 10 26 10
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== sig[i]) {
      throw new Error('角色卡解析失败：不是有效 PNG 文件');
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
        const keyword = new TextDecoder('ascii').decode(data.subarray(0, nullPos));
        if (keyword === 'chara') {
          const b64 = new TextDecoder('ascii').decode(data.subarray(nullPos + 1));
          const jsonText = decodeBase64Utf8(b64);
          return parseCardJson(jsonText);
        }
      }
    }

    // Move past data + CRC (4 bytes)
    offset += length + 4;
  }

  throw new Error('未找到 chara 数据');
}

function mapCardToImport(card: unknown): ImportCharacterCardRequest {
  if (!card || typeof card !== 'object') {
    throw new Error('角色卡 JSON 格式无效');
  }
  // Support v2 (data nested) and v1 (flat)
  const root = (card as { data?: unknown }).data ?? card;
  if (!root || typeof root !== 'object') {
    throw new Error('角色卡 JSON 格式无效');
  }
  const r = root as Record<string, unknown>;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) {
    throw new Error('角色卡缺少必填字段：name');
  }

  const getStr = (key: string): string | undefined => {
    const val = r[key];
    return typeof val === 'string' ? val : undefined;
  };

  return {
    name,
    description: getStr('description'),
    persona: getStr('persona'),
    personality: getStr('personality'),
    scenario: getStr('scenario'),
    firstMessage: getStr('first_mes') ?? getStr('firstMessage'),
    messageExample: getStr('mes_example') ?? getStr('messageExample'),
    systemPrompt: getStr('system_prompt') ?? getStr('systemPrompt'),
    postHistoryInstructions:
      getStr('post_history_instructions') ?? getStr('postHistoryInstructions'),
    rawCardJson: JSON.stringify(card),
    characterBook:
      (r.character_book ?? (card as { character_book?: unknown }).character_book) ??
      undefined,
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
        const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
        card = parseCardJson(text);
      }

      const req = mapCardToImport(card);
      const created = await importCharacterCard(req);
      setSuccess(`已导入：${created.name}。如果角色卡包含世界书，已自动绑定。`);
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
        <h2>导入角色</h2>
      </div>
      <label className={`import-dropzone${importing ? ' import-dropzone--busy' : ''}`}>
        <input
          type="file"
          accept=".json,.png"
          onChange={handleFile}
          disabled={importing}
        />
        <span>{importing ? '导入中...' : '选择 JSON 或 PNG 角色卡'}</span>
        <small>支持 SillyTavern 角色卡，包含世界书时会自动绑定。</small>
      </label>
      {error !== null && <p className="notice notice--error">{error}</p>}
      {success !== null && <p className="notice notice--success">{success}</p>}
    </section>
  );
}
