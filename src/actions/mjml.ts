import mjml2html from 'mjml';
import { t } from '../common/i18n.js';

// mj-include resolves partials from the filesystem of whichever process compiles the template.
// The MJML reaching this function can be shaped by content the model read from a mailbox, so
// inclusion is refused outright. `ignoreIncludes` below would silently drop the tag instead;
// refusing says why, and a silent drop in a message body is its own kind of surprise.
const MJ_INCLUDE = /<\s*mj-include\b/i;

/**
 * Compiles an MJML template to email HTML.
 *
 * This runs in Actions, not in the Worker, and that placement is deliberate: the Worker holds
 * the SMTP and IMAP credentials, the approval secret and the CSRF key, while Actions holds
 * none of them. A parser fed semi-trusted input belongs in the process with less to lose.
 *
 * Compilation happens once, when the proposal is created. The resulting HTML is what gets
 * stored, previewed and sent, so the message a human approves and the message that leaves the
 * server are the same bytes by construction.
 */
export async function compileMjml(source: string): Promise<string> {
  if (MJ_INCLUDE.test(source)) {
    throw new Error(t.validation.mjmlIncludeNotAllowed);
  }

  let result: Awaited<ReturnType<typeof mjml2html>>;
  try {
    result = await mjml2html(source, {
      // Do not render a template that failed validation.
      validationLevel: 'strict',
      // beautify and minify pull js-beautify and htmlnano into the runtime path. Neither
      // improves a message body, and leaving both off keeps those trees unreachable.
      beautify: false,
      minify: false,
      keepComments: false,
      useMjmlConfigOptions: false,
      ignoreIncludes: true
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(t.validation.mjmlCompileFailed(reason));
  }

  if (result.errors.length > 0) {
    const reason = result.errors
      .map((entry) => entry.formattedMessage || entry.message)
      .join('; ');
    throw new Error(t.validation.mjmlCompileFailed(reason));
  }

  const html = result.html.trim();
  if (!html) {
    throw new Error(t.validation.mjmlEmptyOutput);
  }
  return html;
}
