# Consumer guide

Consumers never need this repository. Everything a consumer needs is the **contract package**:

```bash
npm install @datagriff/todo-api-contract      # GitHub Packages, scope @datagriff
```

It ships the OpenAPI spec, TypeScript types, zod schemas, a typed fetch client (`createClient`,
`ApiError`, one function per operation) and a ready-to-run `.http` collection, and it can be
mocked with Prism without any deployment. The full guide — registry auth, authentication with the
platform's Cognito, the client, the mock, the contract conventions — lives in the contract repo:

**→ [aws.contract.template › consumer guide](https://github.com/dataGriff/aws.contract.template/tree/main/docs/consumer-guide)**

What this repository guarantees to consumers: the version of the package this API pins
(`packages/api/package.json`) is the one it is verified against on every PR (`task test:contract`
drives the published client through every operation over real HTTP and replays the collection),
so what you install is what the provider honours. Bumps to the pinned version are visible in this
repo's changelog.
