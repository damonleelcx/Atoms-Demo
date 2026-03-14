/**
 * Fix common agent typo: space inside an identifier breaks JS/TS.
 * Fixes both declarations and usages, e.g.:
 *   const handle KeyboardHeroKey = ... -> const handleKeyboardHeroKey = ...
 *   onKeyDown={handle KeyboardHeroKey}  -> onKeyDown={handleKeyboardHeroKey}
 * Used by ReactLiveAppView and SandpackAppView so preview works after refresh.
 */
const PREFIXES = [
  'handle',
  'on',
  'set',
  'get',
  'is',
  'has',
  'fetch',
  'load',
  'save',
  'update',
  'delete',
  'toggle',
  'open',
  'close',
  'submit',
  'change',
  'click',
  'press',
  'key',
  'mouse',
  'focus',
  'blur',
  'scroll',
  'drag',
  'drop',
  'input',
  'select',
  'add',
  'remove',
  'create',
  'edit',
  'cancel',
  'confirm',
  'reset',
  'clear',
  'start',
  'stop',
  'pause',
  'play',
  'next',
  'prev',
  'go',
  'move',
  'show',
  'hide',
];

export function fixAgentCodeTypo(code: string): string {
  let out = code;
  for (const prefix of PREFIXES) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Declarations: const handle KeyboardHeroKey = / function handle KeyboardHeroKey(
    const reConst = new RegExp(
      `\\bconst\\s+${escaped}\\s+([A-Z][a-zA-Z0-9]*)\\s*=`,
      'g'
    );
    const reFunc = new RegExp(
      `\\bfunction\\s+${escaped}\\s+([A-Z][a-zA-Z0-9]*)\\s*\\(`,
      'g'
    );
    // Usages: handle KeyboardHeroKey in JSX, callbacks, etc.
    const reRef = new RegExp(
      `\\b${escaped}\\s+([A-Z][a-zA-Z0-9]*)`,
      'g'
    );
    out = out.replace(reConst, `const ${prefix}$1 =`);
    out = out.replace(reFunc, `function ${prefix}$1(`);
    out = out.replace(reRef, `${prefix}$1`);
  }
  return out;
}
