/**
 * Map/WeakMap getOrInsert(Computed) polyfill — Stage-3 proposal API that
 * pdfjs-dist 5.7.284 calls on the MAIN thread. No released browser ships it
 * yet; without this, PDF operations die with
 * «this[#t].getOrInsertComputed is not a function».
 *
 * The WORKER side is polyfilled by public/pdf.worker.patched.mjs
 * (scripts/gen-pdf-worker.mjs) — keep the two in sync.
 */

type MapWithProposal = Map<unknown, unknown> & {
  getOrInsertComputed?: (key: unknown, cb: (key: unknown) => unknown) => unknown;
  getOrInsert?: (key: unknown, value: unknown) => unknown;
};
type WeakMapWithProposal = WeakMap<object, unknown> & {
  getOrInsertComputed?: (key: object, cb: (key: object) => unknown) => unknown;
  getOrInsert?: (key: object, value: unknown) => unknown;
};

const M = Map.prototype as MapWithProposal;
const W = WeakMap.prototype as WeakMapWithProposal;

if (typeof M.getOrInsertComputed !== "function") {
  M.getOrInsertComputed = function (this: Map<unknown, unknown>, key, cb) {
    if (this.has(key)) return this.get(key);
    const v = cb(key);
    this.set(key, v);
    return v;
  };
}
if (typeof M.getOrInsert !== "function") {
  M.getOrInsert = function (this: Map<unknown, unknown>, key, value) {
    if (this.has(key)) return this.get(key);
    this.set(key, value);
    return value;
  };
}
if (typeof W.getOrInsertComputed !== "function") {
  W.getOrInsertComputed = function (this: WeakMap<object, unknown>, key, cb) {
    if (this.has(key)) return this.get(key);
    const v = cb(key);
    this.set(key, v);
    return v;
  };
}
if (typeof W.getOrInsert !== "function") {
  W.getOrInsert = function (this: WeakMap<object, unknown>, key, value) {
    if (this.has(key)) return this.get(key);
    this.set(key, value);
    return value;
  };
}

export {};
