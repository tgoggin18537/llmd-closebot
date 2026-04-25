# Ava shell helpers. Copy to ~/.zshrc or source from your existing
# ~/.zshrc. Reads secrets from ~/.ava.env (gitignored, chmod 600).

source ~/.ava.env

# Usage: ava "some inbound text"
#
# Simulates a lead sending `text` to Ava and pretty-prints her reply.
# Assumes opener already sent. For custom state, call the endpoint
# directly with curl.
ava() {
  curl -sX POST "$AVA_URL/debug/simulate" \
    -H 'Content-Type: application/json' \
    -H "x-ghl-webhook-secret: $AVA_WEBHOOK_SECRET" \
    -d "$(printf '{"inbound":"%s","state":{"openerSent":true}}' "$1")" \
    | python3 -m json.tool
}

# Usage: ava_setup_ghl
#
# Creates required tags in the GHL sub-account, audits product tags,
# probes the Worker /health endpoint.
ava_setup_ghl() {
  ( cd ~/code/llmd-closebot/worker \
    && WORKER_URL="$AVA_URL" npx tsx ../ghl-setup/setup.ts )
}

# Usage: ava_deploy
#
# Shortcut for redeploying the Worker from the worker/ dir.
ava_deploy() {
  ( cd ~/code/llmd-closebot/worker && npx wrangler deploy )
}
