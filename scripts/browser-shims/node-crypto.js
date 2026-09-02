// Browser stand-ins for the two node:crypto helpers the store uses.
export const randomUUID = () =>
  (globalThis.crypto && globalThis.crypto.randomUUID)
    ? globalThis.crypto.randomUUID()
    : `id-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;

export const randomBytes = length => {
  const bytes = new Uint8Array(length);
  (globalThis.crypto || { getRandomValues: a => a }).getRandomValues?.(bytes);
  return {
    toString: () => Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join(""),
  };
};
export default { randomUUID, randomBytes };
