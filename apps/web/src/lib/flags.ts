/**
 * Reversible feature flags (server-side environment variables).
 *   CROSSMETRIC_COMMUTER_HOME=0  restores the previous dashboard at "/" (default: commuter app)
 */
export function commuterHomeEnabled(): boolean {
  return process.env.CROSSMETRIC_COMMUTER_HOME !== "0";
}
