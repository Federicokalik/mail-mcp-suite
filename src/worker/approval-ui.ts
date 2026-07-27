import type { Proposal } from '../common/types.js';
import { escapeHtml, signForm } from '../common/security.js';
import { dateLocale, locale, t } from '../common/i18n.js';
import { workerConfig } from './config.js';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(dateLocale, {
    dateStyle: 'full',
    timeStyle: 'long',
    timeZone: workerConfig.APPROVAL_TIMEZONE
  }).format(new Date(value));
}

/**
 * No external fonts, stylesheets or images: the page has to render identically under
 * `default-src 'none'`, and a review surface that depends on the network is a review surface
 * that can be degraded by whoever controls the network.
 */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f0f9ff; --surface: #ffffff; --inset: #f6fbff;
    --fg: #0c4a6e; --fg-muted: #46708a; --border: #bae6fd;
    --primary: #0369a1; --on-primary: #ffffff; --danger: #b91c1c; --ring: #0369a1;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b1620; --surface: #10212e; --inset: #0e1c27;
      --fg: #e3f2fb; --fg-muted: #93b4c8; --border: #1e3a4c;
      --primary: #38bdf8; --on-primary: #06202e; --danger: #f87171; --ring: #38bdf8;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); line-height: 1.55; }
  main { max-width: 44rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.35rem; line-height: 1.3; margin: 0 0 .75rem; }
  h2 { font-size: .95rem; letter-spacing: .02em; text-transform: uppercase;
       color: var(--fg-muted); margin: 1.75rem 0 .5rem; }
  p { margin: 0 0 1rem; }
  a { color: var(--primary); }
  .card { background: var(--surface); border: 1px solid var(--border);
          border-radius: .75rem; padding: 1.25rem; }
  .warning { border-left: .25rem solid var(--danger); padding-left: .9rem;
             margin: 0 0 1.25rem; color: var(--fg); }
  .notice { color: var(--fg-muted); font-size: .92rem; margin: 0 0 1.25rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .5rem 1.25rem; margin: 0; }
  dt { font-weight: 600; color: var(--fg-muted); }
  dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  @media (max-width: 30rem) { dl { grid-template-columns: 1fr; gap: .15rem; }
                              dd { margin-bottom: .6rem; } }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; padding: 1rem;
        border-radius: .6rem; background: var(--inset); border: 1px solid var(--border);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .9rem; }
  .preview { border: 1px solid var(--border); border-radius: .6rem; overflow: hidden;
             background: var(--inset); }
  .preview p { margin: 0; padding: .6rem .85rem; font-size: .85rem; color: var(--fg-muted);
               border-bottom: 1px solid var(--border); }
  .preview iframe { display: block; width: 100%; height: min(70vh, 40rem); border: 0;
                    background: #ffffff; }
  table { width: 100%; border-collapse: collapse; margin: 0; font-size: .92rem; }
  th, td { text-align: left; vertical-align: top; padding: .55rem;
           border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
  form { margin: 1.75rem 0 0; }
  label { display: block; font-weight: 600; margin-bottom: .35rem; }
  input { width: 100%; max-width: 22rem; min-height: 2.75rem; padding: .6rem .7rem;
          border: 1px solid var(--border); border-radius: .45rem;
          background: var(--surface); color: var(--fg); font-size: 1rem; }
  .actions { display: flex; gap: .75rem; flex-wrap: wrap; margin-top: 1.25rem; }
  button { min-height: 2.75rem; padding: .7rem 1.15rem; border-radius: .45rem;
           font-size: 1rem; font-weight: 600; cursor: pointer;
           transition: background-color 150ms ease-out, color 150ms ease-out; }
  .approve { border: 1px solid var(--primary); background: var(--primary); color: var(--on-primary); }
  .cancel { border: 1px solid var(--border); background: transparent; color: var(--fg); }
  :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .error { color: var(--danger); font-weight: 600; margin: 1rem 0 0; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export type ApprovalRow = { label: string; value: string };

export type ApprovalMoveRow = {
  sender: string;
  subject: string;
  source: string;
  destination: string;
  outcome: string;
};

export function approvalRows(proposal: Proposal): ApprovalRow[] {
  if (proposal.kind === 'move') {
    const destinations = [
      ...new Set(proposal.moveItems.map((item) => item.destinationMailbox))
    ].join(', ');
    return [
      { label: t.approval.label.messages, value: String(proposal.moveItems.length) },
      { label: t.approval.label.destination, value: destinations },
      {
        label: t.approval.label.approvalExpires,
        value: formatDate(proposal.approvalExpiresAt)
      },
      ...(proposal.note
        ? [{ label: t.approval.label.note, value: proposal.note }]
        : [])
    ];
  }

  const message = proposal.message;
  return [
    { label: t.approval.label.to, value: message.to.join(', ') },
    ...(message.cc?.length
      ? [{ label: t.approval.label.cc, value: message.cc.join(', ') }]
      : []),
    // Always rendered, even when empty. An absent Bcc row and an empty Bcc row look the same
    // to a reviewer skimming the page, and the two mean very different things.
    { label: t.approval.label.bcc, value: message.bcc?.length ? message.bcc.join(', ') : '—' },
    { label: t.approval.label.subject, value: message.subject },
    {
      label: proposal.scheduledFor
        ? t.approval.label.scheduledSend
        : t.approval.label.send,
      value: proposal.scheduledFor
        ? formatDate(proposal.scheduledFor)
        : t.approval.label.assoonAsApproved
    },
    {
      label: t.approval.label.approvalExpires,
      value: formatDate(proposal.approvalExpiresAt)
    },
    ...(proposal.note
      ? [{ label: t.approval.label.note, value: proposal.note }]
      : [])
  ];
}

export function approvalMoveRows(proposal: Proposal): ApprovalMoveRow[] {
  if (proposal.kind !== 'move') return [];
  return proposal.moveItems.map((item) => ({
    sender: item.from,
    subject: item.subject,
    source: item.sourceMailbox,
    destination: item.destinationMailbox,
    outcome: item.result.status
  }));
}

function metadata(proposal: Proposal): string {
  return approvalRows(proposal)
    .map(
      ({ label, value }) =>
        `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`
    )
    .join('');
}

function moveItemsTable(proposal: Proposal): string {
  if (proposal.kind !== 'move') return '';
  const rows = approvalMoveRows(proposal)
    .map(
      (row) =>
        `<tr>
          <td>${escapeHtml(row.sender)}</td>
          <td>${escapeHtml(row.subject)}</td>
          <td>${escapeHtml(row.source)}</td>
          <td>${escapeHtml(row.destination)}</td>
          <td>${escapeHtml(row.outcome)}</td>
        </tr>`
    )
    .join('');
  return `<table>
    <thead><tr>
      <th>${escapeHtml(t.approval.column.sender)}</th>
      <th>${escapeHtml(t.approval.column.subject)}</th>
      <th>${escapeHtml(t.approval.column.from)}</th>
      <th>${escapeHtml(t.approval.column.to)}</th>
      <th>${escapeHtml(t.approval.column.outcome)}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function approvalCopy(proposal: Proposal): {
  title: string;
  heading: string;
  warning: string;
  approveLabel: string;
} {
  const isMove = proposal.kind === 'move';
  return {
    title: isMove
      ? t.approval.moveTitle(proposal.moveItems.length)
      : t.approval.sendTitle(proposal.message.subject),
    heading: isMove
      ? t.approval.moveHeading
      : t.approval.sendHeading(Boolean(proposal.scheduledFor)),
    warning: isMove ? t.approval.moveWarning : t.approval.sendWarning,
    approveLabel: isMove
      ? t.approval.approveMove
      : proposal.scheduledFor
        ? t.approval.approveSchedule
        : t.approval.sendNow
  };
}

function statusDescription(proposal: Proposal): string {
  const scheduledDate = proposal.scheduledFor
    ? formatDate(proposal.scheduledFor)
    : null;
  const sentDate = proposal.sentAt ? formatDate(proposal.sentAt) : null;
  return proposal.kind === 'move'
    ? t.approval.moveStatus[proposal.status](sentDate)
    : t.approval.sendStatus[proposal.status](
        proposal.status === 'scheduled' ? scheduledDate : sentDate
      );
}

export function renderApproval(proposal: Proposal, error?: string): string {
  if (proposal.status !== 'pending_approval') {
    return renderStatus(proposal);
  }

  const approveCsrf = signForm(
    workerConfig.APPROVAL_CSRF_SECRET,
    proposal.id,
    proposal.createdAt,
    'approve'
  );
  const cancelCsrf = signForm(
    workerConfig.APPROVAL_CSRF_SECRET,
    proposal.id,
    proposal.createdAt,
    'cancel'
  );
  const isMove = proposal.kind === 'move';
  const { title, heading, warning, approveLabel } = approvalCopy(proposal);
  const preview = isMove
    ? `<h2>${escapeHtml(t.approval.label.messages)}</h2>${moveItemsTable(proposal)}`
    : sendBody(proposal);
  // Reading has to come before the gesture, so the secret sits after the whole message.
  return page(
    title,
    `<h1>${escapeHtml(heading)}</h1>
     <p class="warning">${escapeHtml(warning)}</p>
     ${
       proposal.scheduledFor
         ? `<p class="notice">${escapeHtml(t.approval.scheduledNotice)}</p>`
         : ''
     }
     <div class="card"><dl>${metadata(proposal)}</dl></div>
     ${preview}
     ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
     <form method="post" action="/approval/${proposal.id}/approve">
       <label for="approval-secret">${escapeHtml(t.approval.secretLabel)}</label>
       <input id="approval-secret" type="password" name="secret" autocomplete="new-password" required>
       <div class="actions">
         <button class="approve" type="submit" name="csrf" value="${approveCsrf}"
                 formaction="/approval/${proposal.id}/approve">${escapeHtml(approveLabel)}</button>
         <button class="cancel" type="submit" name="csrf" value="${cancelCsrf}"
                 formaction="/approval/${proposal.id}/cancel">${escapeHtml(t.approval.cancelProposal)}</button>
       </div>
     </form>`
  );
}

/**
 * Text part first, then the rendered HTML. The text part is the representation that cannot
 * execute or hide anything, so it is the one shown without being asked for.
 */
function sendBody(proposal: Proposal): string {
  if (proposal.kind !== 'send') return '';
  const text = `<h2>${escapeHtml(t.approval.bodyTextTitle)}</h2>
     <pre>${escapeHtml(proposal.message.text)}</pre>`;
  if (!proposal.message.html) return text;
  return `${text}
     <h2>${escapeHtml(t.approval.bodyHtmlTitle)}</h2>
     <div class="preview">
       <p>${escapeHtml(t.approval.htmlPreviewNotice)}</p>
       <iframe sandbox="" title="${escapeHtml(t.approval.bodyHtmlTitle)}"
               src="/approval/${proposal.id}/preview"></iframe>
     </div>`;
}

/**
 * The HTML body served as its own document, for the sandboxed preview frame. It is returned
 * verbatim — rendering it is the point — so the route that serves this must send the tightened
 * CSP that blocks scripts and every remote fetch, and the frame must carry `sandbox=""`.
 */
export function renderPreviewDocument(proposal: Proposal): string {
  return proposal.kind === 'send' ? (proposal.message.html ?? '') : '';
}

export function renderStatus(proposal: Proposal): string {
  const description = statusDescription(proposal);
  return page(
    t.approval.statusTitle(proposal.status),
    `<h1>${escapeHtml(t.approval.statusHeading(proposal.status))}</h1>
     <p>${escapeHtml(description)}</p>
     <dl>${metadata(proposal)}</dl>
     ${moveItemsTable(proposal)}
     ${proposal.error ? `<p class="error">${escapeHtml(proposal.error)}</p>` : ''}`
  );
}

export function renderSimple(title: string, message: string): string {
  return page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
}

export type ApprovalView = {
  id: string;
  kind: Proposal['kind'];
  status: Proposal['status'];
  locale: string;
  title: string;
  heading: string;
  warning: string;
  rows: ApprovalRow[];
  /** Full message text. Only ever leaves the worker towards the reviewing browser. */
  body: string | null;
  /**
   * Whether an HTML part exists. The HTML itself is deliberately not sent to the in-chat app:
   * inside the host's iframe its rendering would be at the mercy of a policy this project does
   * not control, and a mail rendered without its styles still looks like a mail. The app says
   * so and points at the browser page instead of guessing.
   */
  hasHtml: boolean;
  labels: {
    bodyText: string;
    htmlNotRendered: string;
    openApprovalPage: string;
    scheduledNotice: string | null;
  };
  moveRows: ApprovalMoveRow[];
  columns: {
    sender: string;
    subject: string;
    from: string;
    to: string;
    outcome: string;
  };
  statusText: string;
  statusHeading: string;
  error: string | null;
  /** Present only while the proposal can still be acted on. */
  actions: {
    approveLabel: string;
    cancelLabel: string;
    secretLabel: string;
    approveCsrf: string;
    cancelCsrf: string;
  } | null;
};

/**
 * Same data the browser approval page renders, shaped for the in-chat app.
 * Both views are built from the stored proposal so they cannot drift apart.
 */
export function approvalView(proposal: Proposal): ApprovalView {
  const { title, heading, warning, approveLabel } = approvalCopy(proposal);
  const actionable = proposal.status === 'pending_approval';
  return {
    id: proposal.id,
    kind: proposal.kind,
    status: proposal.status,
    locale,
    title,
    heading,
    warning,
    rows: approvalRows(proposal),
    body: proposal.kind === 'send' ? proposal.message.text : null,
    hasHtml: proposal.kind === 'send' && Boolean(proposal.message.html),
    labels: {
      bodyText: t.approval.bodyTextTitle,
      htmlNotRendered: t.approval.htmlNotRendered,
      openApprovalPage: t.approval.openApprovalPage,
      scheduledNotice: proposal.scheduledFor ? t.approval.scheduledNotice : null
    },
    moveRows: approvalMoveRows(proposal),
    columns: {
      sender: t.approval.column.sender,
      subject: t.approval.column.subject,
      from: t.approval.column.from,
      to: t.approval.column.to,
      outcome: t.approval.column.outcome
    },
    statusText: statusDescription(proposal),
    statusHeading: t.approval.statusHeading(proposal.status),
    error: proposal.error,
    actions: actionable
      ? {
          approveLabel,
          cancelLabel: t.approval.cancelProposal,
          secretLabel: t.approval.secretLabel,
          approveCsrf: signForm(
            workerConfig.APPROVAL_CSRF_SECRET,
            proposal.id,
            proposal.createdAt,
            'approve'
          ),
          cancelCsrf: signForm(
            workerConfig.APPROVAL_CSRF_SECRET,
            proposal.id,
            proposal.createdAt,
            'cancel'
          )
        }
      : null
  };
}
