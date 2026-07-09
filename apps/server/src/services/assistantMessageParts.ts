export interface AssistantMessageParts {
  rawContent: string;
  visibleContent: string;
  htmlComments: string[];
  thinkingBlocks: string[];
  hasOpenThinkingBlock?: boolean;
  hasOpenContentBlock?: boolean;
  updateVariableBlocks: string[];
  variableStateBlocks: string[];
}

const VARIABLE_STATE_HEADING = '【变量状态】';

function normalizeVisibleContent(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function removeHtmlComments(value: string, blocks: string[]): string {
  return value.replace(/<!--[\s\S]*?-->/g, (match) => {
    blocks.push(match);
    return '\n';
  });
}

function removeThinkingBlocks(
  value: string,
  blocks: string[],
): { content: string; hasOpenThinkingBlock: boolean } {
  let content = '';
  let cursor = 0;
  let hasOpenThinkingBlock = false;
  const openPattern = /<think\b[^>]*>/gi;

  while (cursor < value.length) {
    openPattern.lastIndex = cursor;
    const open = openPattern.exec(value);
    if (!open || open.index === undefined) {
      content += value.slice(cursor);
      break;
    }

    content += value.slice(cursor, open.index);
    const bodyStart = open.index + open[0].length;
    const closePattern = /<\/think>/gi;
    closePattern.lastIndex = bodyStart;
    const close = closePattern.exec(value);
    if (!close || close.index === undefined) {
      blocks.push(value.slice(bodyStart).trim());
      hasOpenThinkingBlock = true;
      cursor = value.length;
      break;
    }

    blocks.push(value.slice(bodyStart, close.index).trim());
    cursor = close.index + close[0].length;
  }

  return { content, hasOpenThinkingBlock };
}

function removeUpdateVariableBlocks(value: string, blocks: string[]): string {
  return value.replace(/<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable>/gi, (match) => {
    blocks.push(match);
    return '\n';
  });
}

function removeFencedVariableStateBlocks(value: string, blocks: string[]): string {
  return value.replace(
    /(`{3,})([^\r\n]*)\r?\n([\s\S]*?)\r?\n\1/g,
    (match, _ticks: string, _language: string, body: string) => {
      if (!body.trim().startsWith(VARIABLE_STATE_HEADING)) return match;
      blocks.push(match);
      return '\n';
    },
  );
}

function removeBareVariableStateBlock(value: string, blocks: string[]): string {
  const linePattern = /^.*$/gm;
  for (const match of value.matchAll(linePattern)) {
    if (match[0].trim() === VARIABLE_STATE_HEADING && match.index !== undefined) {
      blocks.push(value.slice(match.index));
      return value.slice(0, match.index);
    }
  }
  return value;
}

function unwrapContentBlock(
  value: string,
): { content: string; hasOpenContentBlock: boolean } {
  const trimmed = value.trim();
  const match = trimmed.match(/^<content\b[^>]*>([\s\S]*)<\/content>$/i);
  if (match) {
    return { content: match[1] ?? '', hasOpenContentBlock: false };
  }

  const openMatch = trimmed.match(/^<content\b[^>]*>([\s\S]*)$/i);
  if (openMatch) {
    return { content: openMatch[1] ?? '', hasOpenContentBlock: true };
  }

  return {
    content: value.replace(/<\/?content\b[^>]*>/gi, ''),
    hasOpenContentBlock: false,
  };
}

export function getThinkingBlockText(block: string): string {
  const match = block.match(/^<think\b[^>]*>([\s\S]*?)<\/think>$/i);
  return (match ? match[1] ?? '' : block).trim();
}

export function splitAssistantMessageParts(content: string): AssistantMessageParts {
  const htmlComments: string[] = [];
  const thinkingBlocks: string[] = [];
  const updateVariableBlocks: string[] = [];
  const variableStateBlocks: string[] = [];
  let visibleContent = content;
  let hasOpenThinkingBlock = false;
  let hasOpenContentBlock = false;

  visibleContent = removeHtmlComments(visibleContent, htmlComments);
  const thinkingResult = removeThinkingBlocks(visibleContent, thinkingBlocks);
  visibleContent = thinkingResult.content;
  hasOpenThinkingBlock = thinkingResult.hasOpenThinkingBlock;
  visibleContent = removeUpdateVariableBlocks(visibleContent, updateVariableBlocks);
  visibleContent = removeFencedVariableStateBlocks(visibleContent, variableStateBlocks);
  visibleContent = removeBareVariableStateBlock(visibleContent, variableStateBlocks);
  const contentResult = unwrapContentBlock(visibleContent);
  visibleContent = contentResult.content;
  hasOpenContentBlock = contentResult.hasOpenContentBlock;

  return {
    rawContent: content,
    visibleContent: normalizeVisibleContent(visibleContent),
    htmlComments,
    thinkingBlocks,
    hasOpenThinkingBlock,
    hasOpenContentBlock,
    updateVariableBlocks,
    variableStateBlocks,
  };
}

export function getAssistantVisibleContent(content: string): string {
  return splitAssistantMessageParts(content).visibleContent;
}
