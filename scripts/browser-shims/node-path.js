// Enough of node:path for the store's key building. No filesystem is involved in the offline build.
export const join = (...parts) => parts.filter(Boolean).join("/");
export const dirname = value => value.split("/").slice(0, -1).join("/") || ".";
export default { join, dirname };
