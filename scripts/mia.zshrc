# Mia shell helpers. Copy to ~/.zshrc or source from your existing
# ~/.zshrc. Reads secrets from ~/.mia.env (gitignored, chmod 600).

source ~/.mia.env

# Usage: mia "some inbound text"
#
# Simulates a lead sending `text` to Mia and pretty-prints her reply.
# Assumes opener already sent. For custom state, call the endpoint
# directly with curl.
mia() {
  curl -sX POST "$MIA_URL/debug/simulate" \
    -H 'Content-Type: application/json' \
    -H "x-ghl-webhook-secret: $MIA_WEBHOOK_SECRET" \
    -d "$(printf '{"inbound":"%s","state":{"openerSent":true}}' "$1")" \
    | python3 -m json.tool
}

# Usage: mia_setup_ghl
#
# Creates required tags in the GHL sub-account, audits product tags,
# probes the Worker /health endpoint.
mia_setup_ghl() {
  ( cd ~/code/llmd-closebot/worker \
    && WORKER_URL="$MIA_URL" npx tsx ../ghl-setup/setup.ts )
}

# Usage: mia_deploy
#
# Shortcut for redeploying the Worker from the worker/ dir.
mia_deploy() {
  ( cd ~/code/llmd-closebot/worker && npx wrangler deploy )
}
