// The offline build never touches a filesystem: persistence is configured to use browser storage before
// anything reads. These exist only so the bundler has something to resolve.
const refuse = () => Promise.reject(new Error("The offline demo build has no filesystem"));
export default { readFile: refuse, writeFile: refuse, mkdir: refuse, rename: refuse, rm: refuse, readdir: refuse };
export const readFile = refuse, writeFile = refuse, mkdir = refuse, rename = refuse, rm = refuse, readdir = refuse;
