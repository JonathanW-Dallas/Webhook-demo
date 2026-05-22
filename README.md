# GitHub → Slack Webhook

Forwards GitHub push, pull request, and issue events to a Slack channel using Block Kit formatting.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create a Slack Incoming Webhook
1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Under **Incoming Webhooks**, activate and click **Add New Webhook to Workspace**
3. Pick a channel and copy the webhook URL

### 3. Set environment variables
```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/XXX/YYY/ZZZ"
export GITHUB_WEBHOOK_SECRET="your-secret"   # optional but recommended
export PORT=3000                              # default: 3000
```

Or create a `.env` file and use a package like `dotenv`.

### 4. Run the server
```bash
npm start          # production
npm run dev        # dev with auto-restart (Node 18+)
```

### 5. Configure the GitHub Webhook
1. Go to your repo (or org) → **Settings → Webhooks → Add webhook**
2. **Payload URL**: `https://your-domain.com/webhook/github`
3. **Content type**: `application/json`
4. **Secret**: same value as `GITHUB_WEBHOOK_SECRET`
5. **Events**: choose *Let me select individual events* and check:
   - Pushes
   - Pull requests
   - Issues

### 6. Expose locally for testing (optional)
```bash
npx ngrok http 3000
# Use the ngrok HTTPS URL as your GitHub Payload URL
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhook/github` | Receives GitHub events |
| GET | `/health` | Health check |

## Supported Events

| Event | Triggers |
|-------|----------|
| `push` | Any branch push with commits |
| `pull_request` | opened, closed, merged, reopened, synchronize |
| `issues` | opened, closed, reopened, labeled |
