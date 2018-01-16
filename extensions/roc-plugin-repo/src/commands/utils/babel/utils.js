/**
 Parts of the code taken from babel-cli
*/

import fs from 'fs-extra';
import path from 'path';

import { transform as transformCore, util } from 'babel-core';

export function chmod(src, dest) {
  return fs.chmod(dest, fs.statSync(src).mode);
}

export const canCompile = util.canCompile;

const mm = require('micromatch');

export function shouldIgnore(loc, ignore = []) {
  return mm.some(loc, ignore);
}

export function addSourceMappingUrl(code, loc) {
  return `${code}\n//# sourceMappingURL=${path.basename(loc)}`;
}

export function transform(filename, code, opts) {
  opts.filename = filename; // eslint-disable-line no-param-reassign

  const result = transformCore(code, opts);
  result.filename = filename;
  result.actual = code;
  return result;
}

export async function compile(log, filename, opts, watch = false) {
  try {
    const code = await fs.readFile(filename, 'utf8');
    return transform(filename, code, opts);
  } catch (err) {
    if (watch) {
      // Leaving the message intentionally blank here
      log('', toErrorStack(err));
      return { ignored: true };
    }

    throw err;
  }
}

function toErrorStack(err) {
  if (err._babel && err instanceof SyntaxError) {
    err.message = `${err.message}\n${err.codeFrame}`; // eslint-disable-line no-param-reassign
  }

  return err;
}
