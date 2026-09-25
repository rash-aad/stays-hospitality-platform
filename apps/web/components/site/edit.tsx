'use client';

import { createContext, useContext, useRef, type ElementType } from 'react';

type EditApi = { editing: boolean; selected: string | null; select: (id: string) => void; update: (sectionId: string, path: string, value: unknown) => void };
export const EditCtx = createContext<EditApi>({ editing: false, selected: null, select: () => {}, update: () => {} });
export const useEdit = () => useContext(EditCtx);

/**
 * Text that is plain on the live site and inline-editable (contentEditable, plain text only)
 * inside the builder. Never renders HTML.
 */
export function T({ sid, path, value, as: Tag = 'span', className, placeholder }: { sid: string; path: string; value: string | undefined | null; as?: ElementType; className?: string; placeholder?: string }) {
  const { editing, update } = useEdit();
  const ref = useRef<HTMLElement>(null);
  if (!editing) return value ? <Tag className={className}>{value}</Tag> : null;
  return (
    <Tag
      ref={ref}
      className={`${className ?? ''} outline-none focus:ring-2 focus:ring-[#0e5a57]/50 empty:before:opacity-40 empty:before:content-[attr(data-placeholder)]`}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder ?? 'Type here…'}
      onPaste={(e: React.ClipboardEvent) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && Tag !== 'p' && Tag !== 'div') { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
      onBlur={(e: React.FocusEvent<HTMLElement>) => { const v = e.currentTarget.innerText.replace(/ /g, ' ').trimEnd(); if (v !== (value ?? '')) update(sid, path, v); }}
    >
      {value}
    </Tag>
  );
}
