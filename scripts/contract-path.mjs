#!/usr/bin/env node
// Prints the installed contract's absolute path (`task contract:path`), for
// shell tools that take a file: Schemathesis, httpyac, redocly, ...
// `--dir` prints the package directory instead.
import { contractDir, contractPath } from "./lib/contract.mjs";

console.log(process.argv.includes("--dir") ? contractDir : contractPath);
