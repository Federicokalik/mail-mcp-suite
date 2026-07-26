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

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 760px; margin: 2.5rem auto; padding: 0 1.25rem 3rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .45rem 1rem; }
  dt { font-weight: 700; opacity: .75; }
  dd { margin: 0; overflow-wrap: anywhere; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 1rem; border-radius: .6rem; background: rgba(127,127,127,.14); }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: .92rem; }
  th, td { text-align: left; vertical-align: top; padding: .55rem; border-bottom: 1px solid rgba(127,127,127,.3); overflow-wrap: anywhere; }
  form { display: flex; gap: .75rem; flex-wrap: wrap; align-items: center; margin-top: 1rem; }
  input { padding: .65rem; min-width: 16rem; }
  button { border: 0; border-radius: .45rem; padding: .7rem 1rem; cursor: pointer; }
  .approve { background: #16833b; color: white; }
  .cancel { background: #a52a2a; color: white; }
  .warning { border-left: .3rem solid #c98b00; padding-left: .8rem; }
  .error { color: #d33; font-weight: 700; }
</style>
</head>
<body>${body}</body>
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
    ...(message.bcc?.length
      ? [{ label: t.approval.label.bcc, value: message.bcc.join(', ') }]
      : []),
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
    ? moveItemsTable(proposal)
    : `<pre>${escapeHtml(proposal.message.text)}</pre>`;
  return page(
    title,
    `<h1>${escapeHtml(heading)}</h1>
     <p class="warning">${escapeHtml(warning)}</p>
     <dl>${metadata(proposal)}</dl>
     ${preview}
     ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
     <form method="post" action="/approval/${proposal.id}/approve">
       <input type="hidden" name="csrf" value="${approveCsrf}">
       <input type="password" name="secret" placeholder="${escapeHtml(t.approval.secretPlaceholder)}" autocomplete="current-password" required>
       <button class="approve" type="submit">${escapeHtml(approveLabel)}</button>
     </form>
     <form method="post" action="/approval/${proposal.id}/cancel">
       <input type="hidden" name="csrf" value="${cancelCsrf}">
       <input type="password" name="secret" placeholder="${escapeHtml(t.approval.secretPlaceholder)}" autocomplete="current-password" required>
       <button class="cancel" type="submit">${escapeHtml(t.approval.cancelProposal)}</button>
     </form>`
  );
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
    secretPlaceholder: string;
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
          secretPlaceholder: t.approval.secretPlaceholder,
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
