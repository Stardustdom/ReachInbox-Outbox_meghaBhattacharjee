const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'FONT']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED']);

/**
 * Keeps only the basic formatting the compose editor can produce. Everything
 * else (scripts, event handlers, links, images, styles) is removed before an
 * email body is rendered in the dashboard.
 */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const clean = (parent: Node) => {
    Array.from(parent.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.parentNode?.removeChild(node);
        return;
      }
      const el = node as HTMLElement;
      if (DROP.has(el.tagName)) {
        el.remove();
        return;
      }
      if (!ALLOWED.has(el.tagName)) {
        clean(el);
        el.replaceWith(...Array.from(el.childNodes)); // unwrap unknown tags, keep their text
        return;
      }
      const align = /text-align:\s*(left|center|right|justify)/i.exec(el.getAttribute('style') ?? '')?.[1];
      const size = el.tagName === 'FONT' ? el.getAttribute('size') : null;
      Array.from(el.attributes).forEach((a) => el.removeAttribute(a.name));
      if (align) el.style.textAlign = align.toLowerCase();
      if (size && /^[1-7]$/.test(size)) el.setAttribute('size', size);
      clean(el);
    });
  };

  clean(doc.body);
  return doc.body.innerHTML;
}

/** Plain-text version of an email body (list previews, validation). */
export function htmlToText(html: string): string {
  const spaced = html.replace(/<(br|\/p|\/div|\/li|\/blockquote)[^>]*>/gi, ' ');
  if (typeof DOMParser === 'undefined') return spaced.replace(/<[^>]+>/g, '');
  return (new DOMParser().parseFromString(spaced, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim();
}
