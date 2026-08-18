import type { ReactNode } from 'react';

type TaskDescriptionMarkdownProps = {
  markdown: string | null | undefined;
};

type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string };

export function TaskDescriptionMarkdown({
  markdown,
}: TaskDescriptionMarkdownProps) {
  const blocks = parseMarkdownBlocks(markdown ?? '');

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 break-words text-sm leading-6 text-slate-200">
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'code', text: codeLines.join('\n') });
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: Math.min(heading[1].length, 3) as 1 | 2 | 3,
        text: heading[2],
      });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'unordered-list', items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'ordered-list', items });
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: quoteLines.join(' ') });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks;
}

function renderBlock(block: MarkdownBlock, index: number) {
  if (block.type === 'heading') {
    const className = 'font-semibold text-slate-100';
    if (block.level === 1) {
      return (
        <h2 key={index} className={className}>
          {renderInlineMarkdown(block.text, `heading-${index}`)}
        </h2>
      );
    }
    return (
      <h3 key={index} className={className}>
        {renderInlineMarkdown(block.text, `heading-${index}`)}
      </h3>
    );
  }

  if (block.type === 'unordered-list') {
    return (
      <ul key={index} className="list-disc space-y-1 pl-5">
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            {renderInlineMarkdown(item, `ul-${index}-${itemIndex}`)}
          </li>
        ))}
      </ul>
    );
  }

  if (block.type === 'ordered-list') {
    return (
      <ol key={index} className="list-decimal space-y-1 pl-5">
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            {renderInlineMarkdown(item, `ol-${index}-${itemIndex}`)}
          </li>
        ))}
      </ol>
    );
  }

  if (block.type === 'quote') {
    return (
      <blockquote
        key={index}
        className="border-l-2 border-slate-700 pl-3 text-slate-300"
      >
        {renderInlineMarkdown(block.text, `quote-${index}`)}
      </blockquote>
    );
  }

  if (block.type === 'code') {
    return (
      <pre
        key={index}
        className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950/70 p-2 text-xs leading-5 text-slate-200"
      >
        <code>{block.text}</code>
      </pre>
    );
  }

  return (
    <p key={index}>{renderInlineMarkdown(block.text, `paragraph-${index}`)}</p>
  );
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-slate-800/80 px-1 py-0.5 text-[0.92em] text-slate-100"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (link) {
        nodes.push(
          <a
            key={key}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="text-indigo-300 underline decoration-indigo-300/50 underline-offset-2"
          >
            {link[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}
