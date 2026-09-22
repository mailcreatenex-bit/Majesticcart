import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/**
 * Markdown -> safe HTML, for blog posts and pages.
 *
 * Markdown source can't carry a `<script>` — that's the whole reason
 * content is authored as Markdown rather than raw HTML — but `marked` still
 * passes inline HTML in the source straight through, so the sanitiser is a
 * second, independent guarantee rather than a redundant one: it holds even
 * if an admin account is compromised and used to paste a script tag into a
 * post body.
 */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { gfm: true, breaks: true }) as string;
  return sanitizeHtml(html, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li', 'blockquote',
      'strong', 'em', 'b', 'i', 'code', 'pre', 'hr', 'br', 'img', 'table', 'thead',
      'tbody', 'tr', 'th', 'td', 'del', 's',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      img: ['src', 'alt', 'title'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    },
  });
}
