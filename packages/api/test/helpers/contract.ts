// Test-side view of scripts/lib/contract.mjs: the contract is the installed
// @datagriff/todo-api-contract package, resolved here once for every test that
// reads the spec or the shipped .http collection as files.
export {
  CONTRACT_PACKAGE,
  collectionPath,
  contractDir,
  contractPath,
  contractVersion,
} from "../../../../scripts/lib/contract.mjs";
