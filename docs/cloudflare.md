**English** · [Italiano](cloudflare.it.md)

# Publish securely with Cloudflare Tunnel and Access

This is the recommended Internet-facing deployment. Cloudflare Tunnel creates
outbound connections from the mail host, so the router does not need inbound port
forwarding. Cloudflare Access authenticates users before traffic reaches the
origin.

Cloudflare changes its dashboard and API over time. Check the current official
documentation before applying production changes:

- [Create a remotely managed tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
- [Publish applications through a tunnel](https://developers.cloudflare.com/tunnel/routing/)
- [Protect a self-hosted application with Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Managed OAuth for non-browser clients](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
- [Cloudflare's managed MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)

## Target layout

Use three hostnames rather than putting all services under one origin:

| Purpose | Public URL | Local service |
|---|---|---|
| Reader MCP | `https://mail-reader.example.com/mcp` | `http://127.0.0.1:3333` |
| Actions MCP | `https://mail-actions.example.com/mcp` | `http://127.0.0.1:3334` |
| Approval page | `https://mail-approve.example.com/approval/...` | `http://127.0.0.1:7337` |

Separate hostnames provide separate Access audiences and policies. They also let a
user connect the Reader without enabling action tools.

## 1. Keep the origins private

Leave `MAIL_MCP_BIND_ADDRESS=127.0.0.1`. Confirm the three health endpoints work
locally and are not reachable from another machine.

Run `cloudflared` on the same host. If it runs in a container, `127.0.0.1` refers
to that container, not the Docker host; attach it to an appropriate network and
use the service names instead. The host service layout is simpler.

## 2. Create a remotely managed tunnel

In the Cloudflare dashboard:

1. Go to **Networking > Tunnels**.
2. Create a Cloudflare Tunnel and choose `cloudflared`.
3. Select the Linux installation method appropriate for the host.
4. Install the connector using the generated token command.
5. Confirm the connector reports healthy before adding routes.

A remotely managed tunnel can be installed as a service with the token shown by
the dashboard:

```sh
sudo cloudflared service install TUNNEL_TOKEN
sudo systemctl status cloudflared
```

The tunnel token is a credential. Do not paste it into issues, prompts, shell
history shared with other users, or this repository. Rotate it if exposed.

For production availability, Cloudflare recommends multiple connectors on separate
hosts. A single connector is reasonable for a home lab but remains a single point
of failure.

## 3. Publish three application routes

Open the tunnel, go to **Routes**, and add one **Published application** route per
hostname:

```text
mail-reader.example.com  -> http://127.0.0.1:3333
mail-actions.example.com -> http://127.0.0.1:3334
mail-approve.example.com -> http://127.0.0.1:7337
```

When routes are created in the dashboard, Cloudflare creates the corresponding
DNS records. Do not add a public origin IP record.

At this moment the hostnames would be public unless Access is already attached.
Proceed immediately to the Access applications, and do not connect a mail account
until protection is verified.

## 4. Create Access policies

Configure an identity provider or Cloudflare One-Time PIN, then create three
self-hosted Access applications. Each application should include exactly one of
the public hostnames above.

Create an explicit **Allow** policy for the intended email addresses or IdP group.
Access policies are default-deny, but a broad `Everyone` or `Bypass` rule defeats
that protection. Use the smallest session duration that is practical.

Recommended policy split:

- Reader: allow the mailbox owner and explicitly trusted users.
- Actions: use an equal or narrower allowlist than Reader.
- Approval: allow only people who possess the approval secret.

Do not use an Access service token for an interactive Claude connection. Service
tokens are for non-human machine-to-machine callers.

## 5. Enable Managed OAuth for the MCP hostnames

Claude and other non-browser MCP clients need an OAuth flow rather than a normal
browser Access cookie. Edit the Reader and Actions Access applications, open
**Advanced settings**, and enable **Managed OAuth**.

Managed OAuth is not required for the approval hostname, which is opened in a
normal browser.

### Allow the in-chat approval app

The approval app runs inside the host's sandboxed iframe. Its requests carry
`Origin: null` and no `CF_Authorization` cookie, so Access would answer them
with a login redirect and the app could never load the proposal.

Add a policy on the approval application, scoped to the app routes only:

- **Path**: `/approval/*/app`, `/approval/*/app-approve`, `/approval/*/app-cancel`
- **Action**: Bypass (or Service Auth with a service token)

Leave the browser page `/approval/:id` protected by the normal policy.

This trades the browser login for the capability token on those three routes.
The token is an HMAC bound to a single proposal, it is delivered to the app and
never to the model in a usable form, and it does not authorize anything on its
own: approving still requires the CSRF signature and the human approval secret.
Rate limiting applies to the app routes exactly as it does to the form.

If you would rather not add the exception, skip it. Clients then fall back to
the elicitation prompt or the plain approval URL, both of which open the
Access-protected page in a normal browser.

Keep Reader and Actions as separate applications. Their Access application
audiences are different and must be configured at the origin.

## 6. Configure origin-side Access validation

Read the Access application audience (`AUD`) for each MCP application and your
team domain. Reader and Actions are separate applications, so each has its own
audience — that is why `.env` names them apart:

```dotenv
# .env
READER_ALLOWED_HOSTS=localhost,127.0.0.1,mail-reader.example.com
PROXY_ALLOWED_HOSTS=localhost,127.0.0.1,mail-actions.example.com

CLOUDFLARE_ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
CLOUDFLARE_ACCESS_EMAILS=user@example.com
READER_ACCESS_AUD=READER_APPLICATION_AUD
ACTIONS_ACCESS_AUD=ACTIONS_APPLICATION_AUD
```

Compose hands each audience to the right service. Use comma-separated addresses
for more than one user. Restart the affected services:

```sh
docker compose up -d reader actions-proxy
```

Cloudflare Access remains the edge enforcement layer. The application also checks
the JWT signature, issuer, audience, and allowed email address as defense in
depth. A static MCP bearer token still works when requests reach the origin
directly, which is why the origin must remain bound to loopback.

Set the public approval URL, the Worker hostname and the trusted proxy depth in
the same `.env`:

```dotenv
# .env
APPROVAL_BASE_URL=https://mail-approve.example.com
WORKER_ALLOWED_HOSTS=localhost,127.0.0.1,worker,mail-approve.example.com
TRUST_PROXY_HOPS=1
```

`TRUST_PROXY_HOPS=1` is correct only when requests reach the Worker through one
trusted proxy hop. Leave it at `0` for direct local or LAN access. An incorrect
value can make rate limiting trust attacker-supplied forwarding headers.

## 7. Validate before use

Test four cases:

1. Local `/healthz` endpoints still return `200`.
2. An unauthorized browser cannot open the approval hostname.
3. An authorized browser can open the approval hostname but cannot approve a
   proposal without the separate approval secret.
4. An MCP client completes Managed OAuth and lists only the expected tools.

Also review **Access authentication logs** after the tests. A healthy tunnel only
proves that `cloudflared` can connect to Cloudflare; it does not prove the origin,
route, Access policy, or JWT audience is correct.

## Let an AI configure Cloudflare

Cloudflare provides an official remote API MCP server at:

```text
https://mcp.cloudflare.com/mcp
```

It authenticates with Cloudflare OAuth and exposes search and execution over the
Cloudflare API. You can add it to an MCP-capable assistant, grant only the scopes
needed for DNS, Tunnel, and Access, and ask the assistant to inspect the account
before proposing changes.

A safe prompt is:

```text
Inspect my existing Cloudflare account. Do not change anything yet.
Propose a remotely managed Tunnel for three local HTTP services on ports
3333, 3334, and 7337, each on a separate hostname. Propose default-deny
Access applications restricted to my identity. Enable Managed OAuth only
for the two /mcp applications. Show exact resources, validation tests, and
rollback. Wait for my explicit approval before each write.
```

After approving the plan, the AI can create Cloudflare-side resources and return
the connector installation command. It cannot install `cloudflared` on your host
unless it also has a separately authorized host-management tool.

Never grant an agent more Cloudflare permissions than required. Ask it to retrieve
existing IDs and API schemas rather than guessing them, and review every mutation.

## Rollback

If remote exposure must be disabled quickly:

1. disable or remove the three published application routes;
2. stop the `cloudflared` service;
3. confirm the local services still bind only to `127.0.0.1`;
4. revoke the tunnel token if compromise is suspected;
5. rotate MCP tokens and the approval secret if they may have leaked.

Removing Access while leaving a published Tunnel route active can make an origin
public. Remove the route first.
