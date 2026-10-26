/**
 * Runs in the document head, before the first paint: `html[data-cm-intro="off"]` hides the launch
 * screen (see premium.css). Skipped for `?intro=0` and under automation, forced on with `?intro=1`.
 * Kept in a plain module (not the client component) so the server layout can read the string.
 */
export const SPLASH_GATE_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search).get("intro");var off=q==="0"||(q!=="1"&&navigator.webdriver);document.documentElement.dataset.cmIntro=off?"off":"on";}catch(e){}})();`;
