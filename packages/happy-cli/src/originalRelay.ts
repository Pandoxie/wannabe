/**
 * Original Happy's relay: the default when neither `HAPPY_SERVER_URL` nor
 * `settings.serverUrl` (in HAPPY_HOME_DIR/settings.json) names one.
 * Upstream defaulted to its cloud (https://api.cluster-fluster.com); no
 * Original Happy machine uses that. Change it here and in
 * happy-agent/src/config.ts together.
 */
export const ORIGINAL_HAPPY_RELAY_URL = 'https://api.cluster-fluster.com';

/**
 * Original Happy's web client, the default for `HAPPY_WEBAPP_URL` /
 * `settings.webappUrl`: the "open this link to connect the terminal" login
 * link (api/webAuth.ts). Upstream's app.happy.engineering talks to its cloud.
 */
export const ORIGINAL_HAPPY_WEBAPP_URL = 'https://pandoxie.github.io/wannabe';
