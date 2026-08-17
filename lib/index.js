/**
 * game-stats-hud — host half.
 *
 * The browser surface lives in ./client.js (declared via dsh.client in
 * package.json). This host half exists so the loader entry is a valid cordis
 * plugin; it intentionally does nothing.
 * @param ctx - host cordis context (unused).
 */
export function apply(ctx) {
  // no-op: the whole plugin is browser-side.
}
