/**
 * Message metrics — Host half.
 *
 * The dashboard lives entirely in the browser: every figure is derived from
 * the assistant message the Session already recorded (provider usage, step
 * and chunk timestamps). This half only gives the bundle a Host row so the
 * package joins the profile's plugin graph and its client bundle is served.
 */

export const name = 'dsh-message-metrics'

/** No Host services are needed; the row exists to carry the client bundle. */
export function apply() {}
