// Replaced temporarily by the guarded production deploy before Wrangler bundles the Worker.
// The committed placeholder makes unguarded deployments immediately detectable by health checks.
// No-op trigger: redeploy main after restoring production D1/R2 bindings in wrangler.jsonc.
export const GIT_SHA = '__DEPLOY_GIT_SHA__';
