# Cleaner

Checks code against the conventions Prettier and TypeScript don't enforce, and says how to fix
each problem it finds. One copy of the rules, shared by
[OpenPaste](https://github.com/alexsilver8/openpaste) and
[OpenSEO](https://github.com/alexsilver8/openseo), that runs as a GitHub Action in CI and as
`pnpm cleaner` on your machine.

```
src/web/components/card/card.tsx
  3:1  ✖  interface CardProps  no-types-in-components
  7:1  ✖  type Size            no-types-in-components

no-types-in-components
  Component files can't declare interfaces or types.
  Move them to <name>.types.ts, next to the component.

✖ 2 problems in 1 file (194 files checked)
```

## Use it in a workflow

Add a step after the checkout, with the folder your components live in:

```yaml
- uses: actions/checkout@v7
- uses: alexsilver8/cleaner@v1
  with:
      paths: src/web
```

It runs on the runner's own Node.js, so it doesn't need `setup-node` or `pnpm install` first, and
it works on pull requests from forks. Put it in a job that's already a required check (or add its
job to the `needs` of your `ci` job) so a problem blocks the merge.

When it finds something, the step fails, each problem shows up as an annotation on its line in the
pull request, and the job summary lists them in a table with how to fix each kind.

| Input   | Default | What it does                                                                                                                 |
| ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `paths` | `src`   | Files and folders to check, separated by spaces or new lines. Folders are searched, skipping `node_modules` and dot folders. |

| Output     | What it is                    |
| ---------- | ----------------------------- |
| `problems` | How many problems were found. |

A path that doesn't exist fails the step, so a typo can't make the check pass by checking nothing.

## Run it locally

Add it as a dev dependency straight from this repository:

```bash
pnpm add -D github:alexsilver8/cleaner#v1
```

Then point the `cleaner` script at the same folder as the workflow:

```json
"scripts": {
	"cleaner": "cleaner src/web"
}
```

`pnpm cleaner` checks the folder, and `pnpm cleaner <file>...` checks just those files. It's the
same bundled script the action runs, with no dependencies of its own.

The lockfile pins the commit you installed, while `@v1` in a workflow follows the latest v1
release. Run `pnpm update @alexsilver8/cleaner` after a release to pick up new rules locally.

## Rules

| Rule                     | What it checks                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `no-types-in-components` | A component file (a `.tsx` file named after its folder, like `card/card.tsx`) declares no interfaces or types. They go in `card.types.ts`. |

## Adding a rule

1. Add it to `RULES` in [`src/rules.mjs`](src/rules.mjs): an id, a one-line description and fix,
   which files it applies to, and a check that returns each problem's node and a short message.
2. Add tests in `tests/rules.test.ts`.
3. Run `pnpm build` and commit `dist/cleaner.cjs` with the change. Other repositories run the
   committed bundle, and CI fails if it doesn't match `src/`.

A new rule can fail repositories that pass today as soon as it's released to `@v1`. Fix them
first, or release the rule as a new major version (`v2`) and move each repository over when it's
ready.

## Development

```bash
pnpm install
pnpm test     # unit tests, plus the bundle run the way GitHub's runner runs it
pnpm build    # bundles src/ and its dependencies into dist/cleaner.cjs
pnpm format
```

## Releasing

Publish a GitHub release tagged like `v1.2.0`. The Major tag workflow then moves `v1` to it, so
every repository using `alexsilver8/cleaner@v1` gets it on its next run. A `v2.0.0` release creates
`v2` and leaves `v1` where it was.

## License

MIT
