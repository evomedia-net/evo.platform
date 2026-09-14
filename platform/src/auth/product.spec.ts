// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { resolveProduct } from './product';
import { renderEmail } from '../email/email-layout';
import { config } from '../config';

const prismaWith = (app: Record<string, unknown> | null) =>
  ({ app: { findFirst: jest.fn().mockResolvedValue(app) } }) as never;

describe('resolveProduct', () => {
  it('prefers the display name a customer should read over the registry slug', async () => {
    const p = await resolveProduct(
      prismaWith({
        name: 'provensheet',
        displayName: 'ProvenSheet',
        callbackUrls: ['https://provensheet.com'],
      }),
      'app_1',
    );
    expect(p).toEqual({ name: 'ProvenSheet', signInUrl: 'https://provensheet.com' });
  });

  it('title-cases the slug when no display name is set, never showing the raw slug', async () => {
    const p = await resolveProduct(
      prismaWith({ name: 'docket-mail', displayName: null, callbackUrls: [] }),
      'app_1',
    );
    expect(p.name).toBe('Docket Mail');
  });

  // The whole point of #103: a ProvenSheet user must not be returned to the operator
  // console. The destination comes from the registry, so it cannot be steered.
  it('returns the app to its own registered URL', async () => {
    const p = await resolveProduct(
      prismaWith({ name: 'x', displayName: 'X', callbackUrls: ['https://x.example.com/cb'] }),
      'app_1',
    );
    expect(p.signInUrl).toBe('https://x.example.com/cb');
  });

  it('ignores a non-http callback entry rather than emitting it as a link', async () => {
    const p = await resolveProduct(
      prismaWith({ name: 'x', displayName: 'X', callbackUrls: ['javascript:alert(1)'] }),
      'app_1',
    );
    expect(p.signInUrl).not.toMatch(/javascript/i);
  });

  it('falls back to the platform for an unknown or absent clientId', async () => {
    expect((await resolveProduct(prismaWith(null), 'app_gone')).name).toBe(config.brand.platformName);
    expect((await resolveProduct(prismaWith(null), undefined)).name).toBe(config.brand.platformName);
  });
});

describe('renderEmail', () => {
  const body = {
    product: 'ProvenSheet',
    heading: 'Reset your ProvenSheet password',
    intro: '<p>Someone asked to reset the password.</p>',
    action: { label: 'Reset my password', url: 'https://platform.test/auth/reset-page?token=abc' },
    outro: '<p>The link is valid for 30 minutes and can be used once.</p>',
  };

  it('names the product and identifies the sender — the report was that it read as phishing', () => {
    const { html, text } = renderEmail(body);
    expect(html).toContain('ProvenSheet');
    expect(html).toMatch(/Evomedia\.net LLC/);
    expect(text).toContain('ProvenSheet');
    expect(text).toMatch(/Evomedia\.net LLC/);
  });

  it('renders the action as a real button, not a bare link', () => {
    const { html } = renderEmail(body);
    // Table-based with a background: what survives Outlook and Gmail.
    expect(html).toMatch(/bgcolor="#1d4067"/);
    expect(html).toContain('Reset my password');
  });

  it('repeats the URL as text, so a client that strips the button still works', () => {
    const { html } = renderEmail(body);
    expect(html.match(/auth\/reset-page\?token=abc/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('always produces a text part — HTML-only mail is a spam signal', () => {
    const { text } = renderEmail(body);
    expect(text).toContain(body.action.url);
    expect(text).not.toMatch(/<[a-z]/i);
  });

  // The real caller emphasises the address with <strong>. That markup belongs
  // in the HTML part only; it leaked into the text part verbatim until the
  // paragraphs were stripped for it.
  it('strips markup from the text part instead of printing the tags', () => {
    const { html, text } = renderEmail({
      ...body,
      intro: '<p>Reset the password for <strong>kelly@evomedia.net</strong>.</p>',
    });
    expect(html).toContain('<strong>kelly@evomedia.net</strong>');
    expect(text).toContain('kelly@evomedia.net');
    expect(text).not.toContain('<strong>');
  });

  it('escapes values that came from a user', () => {
    const { html } = renderEmail({
      ...body,
      product: '<script>alert(1)</script>',
      action: { label: 'Go', url: 'https://x.test/?a="b' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('?a="b');
  });

  // A self-hosted instance must be able to sign its own mail. Platform-level
  // only: the product is named per app, the company is the installation's.
  it('names the installation company from config, not a hardcoded string', () => {
    const { html, text } = renderEmail(body);
    expect(html).toContain(`an ${config.brand.company} product`);
    expect(text).toContain(`an ${config.brand.company} product`);
  });

  // Copy authored in the console editor arrives as bare <p>. Without an inline
  // style Outlook renders the spacing as a wall of text.
  it('gives editor-authored paragraphs the inline style mail clients need', () => {
    const { html } = renderEmail({ ...body, intro: '<p>One.</p><p>Two.</p>' });
    expect(html).toContain('<p style="margin:0 0 14px;font-size:15px');
    expect(html).not.toContain('<p>One.</p>');
  });

  it('keeps a style the author set rather than overriding it', () => {
    const { html } = renderEmail({ ...body, intro: '<p style="color:red">Mine.</p>' });
    expect(html).toContain('<p style="color:red">Mine.</p>');
  });

  it('breaks paragraphs into lines in the text part, instead of running them together', () => {
    const { text } = renderEmail({ ...body, intro: '<p>One.</p><p>Two.</p>' });
    expect(text.replace(/\r/g, '')).toContain('One.\nTwo.');
  });

  it('renders a list as dashes in the text part', () => {
    const { text } = renderEmail({ ...body, intro: '<ul><li>alpha</li><li>beta</li></ul>' });
    expect(text).toContain('- alpha');
    expect(text).toContain('- beta');
  });

  it('omits the button entirely when there is nothing to click', () => {
    const { html } = renderEmail({ ...body, action: undefined });
    expect(html).not.toContain('bgcolor');
  });
});
