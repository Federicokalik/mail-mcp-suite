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

function metadata(proposal: Proposal): string {
  if (proposal.kind === 'move') {
    const destinations = [
      ...new Set(proposal.moveItems.map((item) => item.destinationMailbox))
    ].join(', ');
    const rows: Array<[string, string]> = [
      [t.approval.label.messages, String(proposal.moveItems.length)],
      [t.approval.label.destination, destinations],
      [t.approval.label.approvalExpires, formatDate(proposal.approvalExpiresAt)],
      ...(proposal.note
        ? ([[t.approval.label.note, proposal.note]] as Array<[string, string]>)
        : [])
    ];
    return rows
      .map(
        ([label, value]) =>
          `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`
      )
      .join('');
  }

  const message = proposal.message;
  const rows: Array<[string, string]> = [
    [t.approval.label.to, message.to.join(', ')],
    ...(message.cc?.length
      ? ([[t.approval.label.cc, message.cc.join(', ')]] as Array<[string, string]>)
      : []),
    ...(message.bcc?.length
      ? ([[t.approval.label.bcc, message.bcc.join(', ')]] as Array<[string, string]>)
      : []),
    [t.approval.label.subject, message.subject],
    [
      proposal.scheduledFor
        ? t.approval.label.scheduledSend
        : t.approval.label.send,
      proposal.scheduledFor
        ? formatDate(proposal.scheduledFor)
        : t.approval.label.assoonAsApproved
    ],
    [t.approval.label.approvalExpires, formatDate(proposal.approvalExpiresAt)],
    ...(proposal.note
      ? ([[t.approval.label.note, proposal.note]] as Array<[string, string]>)
      : [])
  ];
  return rows
    .map(
      ([label, value]) =>
        `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`
    )
    .join('');
}

function moveItemsTable(proposal: Proposal): string {
  if (proposal.kind !== 'move') return '';
  const rows = proposal.moveItems
    .map(
      (item) =>
        `<tr>
          <td>${escapeHtml(item.from)}</td>
          <td>${escapeHtml(item.subject)}</td>
          <td>${escapeHtml(item.sourceMailbox)}</td>
          <td>${escapeHtml(item.destinationMailbox)}</td>
          <td>${escapeHtml(item.result.status)}</td>
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
  const title = isMove
    ? t.approval.moveTitle(proposal.moveItems.length)
    : t.approval.sendTitle(proposal.message.subject);
  const heading = isMove
    ? t.approval.moveHeading
    : t.approval.sendHeading(Boolean(proposal.scheduledFor));
  const warning = isMove ? t.approval.moveWarning : t.approval.sendWarning;
  const preview = isMove
    ? moveItemsTable(proposal)
    : `<pre>${escapeHtml(proposal.message.text)}</pre>`;
  const approveLabel = isMove
    ? t.approval.approveMove
    : proposal.scheduledFor
      ? t.approval.approveSchedule
      : t.approval.sendNow;
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
  const scheduledDate = proposal.scheduledFor
    ? formatDate(proposal.scheduledFor)
    : null;
  const sentDate = proposal.sentAt ? formatDate(proposal.sentAt) : null;
  const description =
    proposal.kind === 'move'
      ? t.approval.moveStatus[proposal.status](sentDate)
      : t.approval.sendStatus[proposal.status](
          proposal.status === 'scheduled' ? scheduledDate : sentDate
        );
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
