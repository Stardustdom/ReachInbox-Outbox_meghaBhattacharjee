'use client';
import { useRef } from 'react';
import { sanitizeHtml } from '@/lib/html';

interface Props {
  placeholder?: string;
  /** Called on every edit with the sanitized HTML and its plain text. */
  onChange: (html: string, text: string) => void;
}

type Tool = { label: string; title: string; cmd: string; arg?: string; className?: string };

const GROUPS: Tool[][] = [
  [
    { label: '↶', title: 'Undo', cmd: 'undo' },
    { label: '↷', title: 'Redo', cmd: 'redo' },
  ],
  [
    { label: 'B', title: 'Bold', cmd: 'bold', className: 'font-bold' },
    { label: 'I', title: 'Italic', cmd: 'italic', className: 'italic' },
    { label: 'U', title: 'Underline', cmd: 'underline', className: 'underline' },
    { label: 'S', title: 'Strikethrough', cmd: 'strikeThrough', className: 'line-through' },
  ],
  [
    { label: '⇤', title: 'Align left', cmd: 'justifyLeft' },
    { label: '↔', title: 'Align center', cmd: 'justifyCenter' },
  ],
  [
    { label: '•≡', title: 'Bulleted list', cmd: 'insertUnorderedList' },
    { label: '1≡', title: 'Numbered list', cmd: 'insertOrderedList' },
  ],
  [
    { label: '→|', title: 'Indent', cmd: 'indent' },
    { label: '|←', title: 'Outdent', cmd: 'outdent' },
    { label: '❝', title: 'Quote', cmd: 'formatBlock', arg: 'blockquote' },
  ],
];

const SIZES = [
  { label: 'Small', value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Large', value: '5' },
];

/** Small contentEditable editor with the toolbar from the design. */
export function RichTextEditor({ placeholder, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    onChange(sanitizeHtml(el.innerHTML), el.innerText.trim());
  };

  const run = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  return (
    <div className="rounded-xl bg-surface p-3 sm:p-4">
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Email body"
        data-placeholder={placeholder}
        onInput={emit}
        className="rte min-h-[220px] whitespace-pre-wrap break-words text-sm outline-none sm:min-h-[300px]"
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 rounded-lg bg-white px-2 py-1.5">
        {GROUPS.map((group, gi) => (
          <div key={gi} className="flex items-center gap-0.5 border-r border-gray-200 pr-1 last:border-0">
            {gi === 1 && (
              <select
                aria-label="Text size"
                defaultValue="3"
                onChange={(e) => run('fontSize', e.target.value)}
                className="mr-1 h-7 rounded bg-transparent text-xs text-gray-600 focus:outline-none"
              >
                {SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
            {group.map((t) => (
              <button
                key={t.title}
                type="button"
                title={t.title}
                aria-label={t.title}
                onMouseDown={(e) => e.preventDefault()} // keep the text selection
                onClick={() => run(t.cmd, t.arg)}
                className={`flex h-7 min-w-7 items-center justify-center rounded px-1 text-sm text-gray-600 hover:bg-gray-100 ${t.className ?? ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
