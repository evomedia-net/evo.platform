// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The shell every platform email is rendered into.
 *
 * A transactional message that names no product, shows a bare link and carries
 * no sender identity reads as phishing — which is exactly the report that
 * produced this file (#103). The fix is not decoration: a recipient deciding
 * whether to trust a password-reset link needs to see *which product* it came
 * from and *who sent it* before they click anything.
 *
 * Deliberately table-based with inline styles. Mail clients are not browsers:
 * Outlook ignores most of flexbox and grid, Gmail strips <style> blocks in
 * some contexts, and a <div> button with padding collapses in several. A
 * table with inline attributes is the layout that survives all of them.
 *
 * Platform-level only. Products are named by a variable, never themed
 * separately — one template that says "SWAG Estimates" beats a per-product
 * template set that drifts apart, and there is no per-tenant theming at all.
 */

import { config } from '../config';

const BRAND = '#1d4067';
const INK = '#14304a';
const MUTED = '#5b6b7d';
const RULE = '#dbe3ec';

/** HTML-escape a value that came from a user or a database row. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailBody {
  /** Product this message is about, e.g. "SWAG Estimates". */
  product: string;
  /** Lead line under the heading. */
  heading: string;
  /** HTML block before the button. */
  intro: string;
  /** The one action. Omitted for messages with nothing to click. */
  action?: { label: string; url: string };
  /** HTML block after the button (expiry, "wasn't you", etc.). */
  outro: string;
}

/**
 * Give every paragraph the inline style mail clients need.
 *
 * Copy is authored in the console's editor, which emits plain `<p>` — and a
 * `<p>` with no inline style inherits nothing useful in Outlook, so the
 * carefully spaced message arrives as a wall of text. Styling here rather than
 * asking an author to hand-write inline CSS keeps the editor usable.
 */
function styleParagraphs(html: string): string {
  const style = `margin:0 0 14px;font-size:15px;line-height:1.55;color:${INK}`;
  return html
    .replace(/<p(?![^>]*\sstyle=)/gi, `<p style="${style}"`)
    .replace(/<(ul|ol)(?![^>]*\sstyle=)/gi, `<$1 style="margin:0 0 14px 0;padding-left:22px;color:${INK}"`)
    .replace(/<li(?![^>]*\sstyle=)/gi, `<li style="font-size:15px;line-height:1.55"`)
    .replace(/<a(?![^>]*\sstyle=)/gi, `<a style="color:${BRAND}"`);
}

/**
 * A message as both parts. Text is not an afterthought: HTML-only mail is a
 * spam signal and unreadable to anyone using a screen reader or a text client,
 * and the link must survive in it — a button is invisible without markup.
 */
export function renderEmail(body: EmailBody): { html: string; text: string } {

  const button = body.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0">
         <tr><td align="center" bgcolor="${BRAND}" style="border-radius:8px">
           <a href="${esc(body.action.url)}"
              style="display:inline-block;padding:12px 26px;font-family:Helvetica,Arial,sans-serif;
                     font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">
             ${esc(body.action.label)}
           </a>
         </td></tr>
       </table>
       <!-- Every mail client that blocks or mangles the button still needs the
            destination to be reachable, so it is repeated as plain text. -->
       <p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:${MUTED};word-break:break-all">
         If the button does not work, paste this into your browser:<br/>
         <span style="color:${MUTED}">${esc(body.action.url)}</span>
       </p>`
    : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(body.product)}</title></head>
<body style="margin:0;padding:0;background:#f4f7fb">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f7fb">
  <tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:520px;background:#ffffff;border:1px solid ${RULE};border-radius:12px">
      <tr><td style="padding:22px 28px 0">
        <span style="font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:${BRAND}">
          ${esc(body.product)}
        </span>
      </td></tr>
      <tr><td style="padding:14px 28px 0"><hr style="border:0;border-top:1px solid ${RULE};margin:0"/></td></tr>
      <tr><td style="padding:20px 28px 26px;font-family:Helvetica,Arial,sans-serif">
        <h1 style="margin:0 0 14px;font-size:19px;line-height:1.3;color:${INK}">${esc(body.heading)}</h1>
        ${styleParagraphs(body.intro)}
        ${button}
        ${styleParagraphs(body.outro)}
      </td></tr>
      <tr><td style="padding:0 28px 22px;font-family:Helvetica,Arial,sans-serif">
        <hr style="border:0;border-top:1px solid ${RULE};margin:0 0 14px"/>
        <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED}">
          Sent by ${esc(body.product)}, an ${esc(config.brand.company)} product.<br/>
          This is an automated message about your account — you cannot reply to it.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  // Paragraphs may carry light markup (<strong> around an address) for the
  // HTML part; the text part must not show the tags. Stripping here rather
  // than asking callers to write every line twice, which is how the two parts
  // drift apart.
  const plain = (s: string) =>
    s
      // Block ends become line breaks *before* tags are stripped, or every
      // paragraph runs into the next one in the text part.
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

  const text = [
    body.product,
    '',
    body.heading,
    '',
    plain(body.intro).trim(),
    ...(body.action ? ['', `${body.action.label}: ${body.action.url}`, ''] : []),
    plain(body.outro).trim(),
    '',
    '—',
    `Sent by ${body.product}, an ${config.brand.company} product.`,
    'This is an automated message about your account — you cannot reply to it.',
  ].join('\n');

  return { html, text };
}
