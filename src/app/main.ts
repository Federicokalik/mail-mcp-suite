import { App } from '@modelcontextprotocol/ext-apps';

/**
 * In-chat counterpart of the worker's browser approval page.
 *
 * The host renders this file inside a sandboxed iframe and hands it the tool
 * result `_meta`, which carries only where the worker is and a capability token
 * for this one proposal. Everything shown below — recipients, subject, full
 * body — is fetched straight from the worker, so the model never sees the
 * message content and never sees the approval secret typed here.
 */

type ApprovalRow = { label: string; value: string };

type ApprovalMoveRow = {
  sender: string;
  subject: string;
  source: string;
  destination: string;
  outcome: string;
};

type ApprovalView = {
  id: string;
  kind: 'send' | 'move';
  status: string;
  locale: string;
  title: string;
  heading: string;
  warning: string;
  rows: ApprovalRow[];
  body: string | null;
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
  actions: {
    approveLabel: string;
    cancelLabel: string;
    secretLabel: string;
    approveCsrf: string;
    cancelCsrf: string;
  } | null;
};

type ApprovalContext = {
  proposalId: string;
  appToken: string;
  approvalOrigin: string;
};

const root = document.getElementById('root') as HTMLElement;
let context: ApprovalContext | undefined;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function notice(message: string): void {
  root.replaceChildren(element('p', message, 'error'));
}

function readContext(meta: unknown): ApprovalContext | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined;
  const candidate = (meta as Record<string, unknown>)['mail/approval'];
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const { proposalId, appToken, approvalOrigin } = candidate as Record<
    string,
    unknown
  >;
  if (
    typeof proposalId !== 'string' ||
    typeof appToken !== 'string' ||
    typeof approvalOrigin !== 'string'
  ) {
    return undefined;
  }
  return { proposalId, appToken, approvalOrigin };
}

async function call(path: string, body?: unknown): Promise<ApprovalView> {
  if (!context) throw new Error('Missing approval context.');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${context.appToken}`
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${context.approvalOrigin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

  const payload = (await response.json().catch(() => ({}))) as {
    view?: ApprovalView;
    error?: string;
    message?: string;
  };
  if (!response.ok || !payload.view) {
    throw new Error(
      payload.message ?? payload.error ?? `HTTP ${String(response.status)}`
    );
  }
  return payload.view;
}

function renderRows(view: ApprovalView): HTMLElement {
  const list = element('dl');
  for (const row of view.rows) {
    list.append(element('dt', row.label), element('dd', row.value));
  }
  return list;
}

function renderMoveTable(view: ApprovalView): HTMLElement {
  const table = element('table');
  const head = element('tr');
  for (const label of [
    view.columns.sender,
    view.columns.subject,
    view.columns.from,
    view.columns.to,
    view.columns.outcome
  ]) {
    head.append(element('th', label));
  }
  const header = element('thead');
  header.append(head);
  table.append(header);

  const body = element('tbody');
  for (const row of view.moveRows) {
    const line = element('tr');
    for (const value of [
      row.sender,
      row.subject,
      row.source,
      row.destination,
      row.outcome
    ]) {
      line.append(element('td', value));
    }
    body.append(line);
  }
  table.append(body);

  const wrapper = element('div', undefined, 'scroll');
  wrapper.append(table);
  return wrapper;
}

function renderActions(view: ApprovalView, failure?: string): HTMLElement {
  const actions = view.actions as NonNullable<ApprovalView['actions']>;
  const form = element('form');
  const label = element('label', actions.secretLabel);
  label.htmlFor = 'approval-secret';
  const secret = element('input');
  secret.id = 'approval-secret';
  secret.type = 'password';
  secret.required = true;
  // Deliberately not 'current-password': a stored, autofilled approval secret is a secret the
  // environment holds, and anything driving this browser could submit the form without knowing
  // it. The knowledge factor is the whole point of the human approval step.
  secret.autocomplete = 'new-password';

  const approve = element('button', actions.approveLabel, 'approve');
  approve.type = 'submit';
  const cancel = element('button', actions.cancelLabel, 'cancel');
  cancel.type = 'button';

  const submit = async (action: 'approve' | 'cancel'): Promise<void> => {
    if (!secret.value) {
      secret.reportValidity();
      return;
    }
    approve.disabled = true;
    cancel.disabled = true;
    try {
      render(
        await call(`/approval/${view.id}/app-${action}`, {
          csrf: action === 'approve' ? actions.approveCsrf : actions.cancelCsrf,
          secret: secret.value
        })
      );
    } catch (error) {
      approve.disabled = false;
      cancel.disabled = false;
      secret.value = '';
      render(view, error instanceof Error ? error.message : String(error));
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit('approve');
  });
  cancel.addEventListener('click', () => void submit('cancel'));

  const buttons = element('div', undefined, 'actions');
  buttons.append(approve, cancel);
  form.append(label, secret, buttons);

  const container = element('div');
  if (failure) {
    const message = element('p', failure, 'error');
    message.setAttribute('role', 'alert');
    container.append(message);
  }
  container.append(form);
  return container;
}

/**
 * The HTML part is not rendered here. Inside the host's iframe the frame policy is not ours to
 * set, and a message rendered without its styles is still convincing enough to be approved —
 * which is exactly the mistake this whole flow exists to prevent. So the app says the HTML is
 * not shown and sends the reviewer to the page that does render it faithfully.
 */
function renderHtmlFallback(view: ApprovalView): HTMLElement {
  const box = element('div', undefined, 'fallback');
  box.setAttribute('role', 'status');
  box.append(element('p', view.labels.htmlNotRendered));
  if (context) {
    const link = element('a', view.labels.openApprovalPage);
    link.href = `${context.approvalOrigin}/approval/${view.id}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    box.append(link);
  }
  return box;
}

function render(view: ApprovalView, failure?: string): void {
  document.documentElement.lang = view.locale;
  const pending = view.actions !== null;
  const parts: HTMLElement[] = [
    element('h1', pending ? view.heading : view.statusHeading)
  ];

  if (pending) {
    parts.push(element('p', view.warning, 'warning'));
    if (view.labels.scheduledNotice) {
      parts.push(element('p', view.labels.scheduledNotice, 'notice'));
    }
  } else {
    parts.push(element('p', view.statusText));
  }

  const card = element('div', undefined, 'card');
  card.append(renderRows(view));
  parts.push(card);

  if (view.kind === 'move') {
    parts.push(renderMoveTable(view));
  } else if (view.body !== null) {
    parts.push(element('h2', view.labels.bodyText));
    parts.push(element('pre', view.body));
    if (view.hasHtml) parts.push(renderHtmlFallback(view));
  }
  if (view.error) {
    const failed = element('p', view.error, 'error');
    failed.setAttribute('role', 'alert');
    parts.push(failed);
  }
  if (pending) parts.push(renderActions(view, failure));

  root.replaceChildren(...parts);
}

const app = new App({ name: 'mail-approval', version: '3.1.0' });

app.ontoolresult = (result) => {
  const next = readContext(result._meta);
  if (!next) {
    notice('This host did not provide the approval context.');
    return;
  }
  context = next;
  void call(`/approval/${next.proposalId}/app`)
    .then((view) => render(view))
    .catch((error: unknown) =>
      notice(error instanceof Error ? error.message : String(error))
    );
};

await app.connect();
