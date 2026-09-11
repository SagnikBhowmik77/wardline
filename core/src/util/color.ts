/**
 * Zero-dependency ANSI styling. Colour is disabled for pipes, for NO_COLOR,
 * and whenever the CLI passes `--no-color`.
 */

const ESC = String.fromCharCode(27) + '[';

let enabled =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  Boolean(process.stdout.isTTY);

export function setColorEnabled(value: boolean): void {
  enabled = value;
}

export function isColorEnabled(): boolean {
  return enabled;
}

function wrap(open: number, close: number) {
  return (text: string): string =>
    enabled ? `${ESC}${open}m${text}${ESC}${close}m` : text;
}

export const style = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  white: wrap(97, 39),
};
