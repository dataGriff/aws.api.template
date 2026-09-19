// Where the contract lives: inside the installed @datagriff/todo-api-contract
// package (never a file in this repo). Everything that needs the spec as a
// FILE (the gateway renderer, Schemathesis, httpyac, the route-table test)
// resolves it through here, so bumping the package bumps every consumer.
import { createRequire } from "node:module";
import { dirname } from "node:path";

export const CONTRACT_PACKAGE = "@datagriff/todo-api-contract";

// Resolve from the API package: the contract is ITS dependency (pnpm installs
// it under packages/api/node_modules), not the workspace root's.
const require = createRequire(new URL("../../packages/api/package.json", import.meta.url));

/** Absolute path of the installed package's openapi.yaml. */
export const contractPath = require.resolve(`${CONTRACT_PACKAGE}/openapi.yaml`);

/** Absolute path of the installed package (its package.json directory). */
export const contractDir = dirname(require.resolve(`${CONTRACT_PACKAGE}/package.json`));

/** The installed package's version (what the API is verified against). */
export const contractVersion = require(`${CONTRACT_PACKAGE}/package.json`).version;

/** Absolute path of a shipped .http collection file, e.g. collectionPath("todos.http"). */
export const collectionPath = (file) => require.resolve(`${CONTRACT_PACKAGE}/collections/${file}`);
