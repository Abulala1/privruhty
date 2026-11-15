# Vultr Cloud Compute integration

Status: deployment configuration and extension integration implemented; no Vultr instance is provisioned and no cloud performance result is claimed. All example domain/server values are placeholders.

Privruhty can run its FastAPI/Presidio/spaCy detector on a Vultr CPU instance. Two workers preload the language model before accepting traffic. Caddy terminates HTTPS; the detector port is private to Docker. Gemini remains optional and receives only approved education metadata, never original drafts through the explanation route. Raw scan text does reach your detector server when cloud mode is enabled.

## Deploy when ready

1. Provision an Ubuntu Vultr instance with Docker Compose available. Start with at least 4 GB RAM for this two-worker configuration; choose a region near users and measure latency. This is a starting estimate, not a benchmark. No GPU is needed for the current detector.
2. Set a DNS A record for `privacy.your-domain.com` to `YOUR_VULTR_IP`. If using IPv6, configure its record and firewall too.
3. Allow TCP 80/443 publicly and SSH only from your admin IP, both in the Vultr Firewall Group and instance firewall. Do not expose 8765.
4. SSH to `YOUR_SSH_USER@YOUR_VULTR_IP`, clone this repository, and run the commands below. Replace every placeholder. Never commit `.env`.

```sh
git clone https://github.com/Abulala1/privruhty.git
cd privruhty/deploy/vultr
cp .env.example .env
chmod 600 .env
# Generate a token, paste it into .env and your extension Settings:
openssl rand -hex 32
# Edit .env: domain, token, and chrome-extension://YOUR_EXTENSION_ID
# Optional: set your Gemini API key and model here, on the server only.
nano .env
docker compose up -d --build
docker compose ps
curl --fail https://privacy.your-domain.com/health
```

The extension ID is visible at `chrome://extensions`. Allow each development/production ID explicitly if needed, separated by commas. The server refuses cloud startup without an environment token and allowed origins. A token is still required for requests with no Origin header. TLS certificates need working public DNS and reachable ports. Caddy and Uvicorn access logging are disabled; avoid adding body/token logging in external monitoring. Scan bodies are processed in memory without an application database. Cloud providers and administrators remain part of the trust boundary.

## Connect and measure

Rebuild and reload the extension, refresh chat tabs, then open Settings → Vultr cloud detector. Enter the HTTPS origin and server token, confirm the raw-text disclosure, select Use cloud detector, and Save. Chrome asks for access to only the selected origin. Test cloud connection sends a synthetic email and shows round-trip milliseconds. Compare against local testing before claiming a speed improvement. Cloud failure uses limited on-device regex checks, without forwarding to another server.

Gemini configuration is separate: enable Gemini education in VoiceGuard Settings and approve metadata disclosure in each review. An empty key/model leaves local lessons available. No paid service is contacted by the sample configuration.

## Verification limits

Local unit/browser tests cover endpoint selection, consent, permission refusal, fallback, and existing workflows. Docker and a Vultr account are not available in this workspace, so image startup, TLS issuance, and live throughput must be verified after deployment. Test with synthetic data first. For a public multi-user service, add per-user credentials, rate limiting and operational monitoring before opening access widely.

Sources: [Vultr provisioning](https://docs.vultr.com/products/compute/instances/cloud-compute/provisioning), [Vultr Firewall Groups](https://docs.vultr.com/products/compute/instances/cloud-compute/networking/enable-firewall), [FastAPI model lifespan](https://fastapi.tiangolo.com/advanced/events/), [Caddy request limits](https://caddyserver.com/docs/caddyfile/directives/request_body).
