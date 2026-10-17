# Cleaner

Checks code against the conventions Prettier and TypeScript don't enforce, and says how to fix
each problem it finds. One copy of the rules, shared by
[OpenPaste](https://github.com/alexsilver8/open-paste) and
[OpenSEO](https://github.com/alexsilver8/open-seo), that runs as a GitHub Action in CI and as
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

## What it checks

Cleaner checks `.ts` and `.tsx` files, but not `.d.ts` files. Most rules are about component
files: `.tsx` files named after their folder, like `card/card.tsx` or `Card/Card.tsx`. The
component's name comes from the file, so `top-bar.tsx` is `TopBar`. Other files in the folder,
like `card/index.tsx` or `card/card-header.tsx`, aren't component files.

### Component files

| Rule                       | What it checks                                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-types-in-components`   | No interfaces or type aliases anywhere in the file, exported or not, including inside the component. They go in `card.types.ts`. Enums aren't flagged.                                                            |
| `no-helpers-in-components` | The file holds its component and nothing else. Constants go in `card.constants.ts`, functions in `card.utils.ts` and other components in their own folders. It exports nothing but the component.                 |
| `memo-default-export`      | The file ends with `export default memo(Card)`, wrapping the component named after the file.                                                                                                                      |
| `destructure-props`        | The component takes `props` and reads it through `const { … } = props` on its first line, followed by a blank line. No destructuring in the parameters, `props.x` or `{...props}`. Components without props pass. |
| `component-index`          | The folder's `index.ts` re-exports the component by name: `export { default as Card } from './card'`.                                                                                                             |
| `max-component-lines`      | The file is at most 250 lines, counting every line like your editor does. Split a longer one into components in a `components` folder next to it. Reported at line 1.                                             |

### Every file

| Rule                       | What it checks                                                                                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kebab-case-files`         | Folder and file names are kebab-case, like `top-bar/top-bar.types.ts`. Next.js route folders like `(group)`, `[id]`, `[...slug]` and `@slot` pass when the name inside is kebab-case.                                                                                                     |
| `no-parent-imports`        | No `../` in imports, re-exports or `import()`. Use the project's alias, like `@web/…`, or `./` for the same folder and below.                                                                                                                                                             |
| `import-component-folders` | Imports point at a component's folder, like `./components/card`, not at files inside it like `card/card`, `card/card.types` or `card/index`. A component can import its parent's own files, like `share-previews.utils`, since going through the parent's `index.ts` would import itself. |
| `blank-line-before-return` | A `return` that isn't first in its block has a blank line above it, or above the comment directly over it.                                                                                                                                                                                |
| `no-void`                  | No `void` operator. Call the function as a plain statement, or give an arrow function a block body.                                                                                                                                                                                       |
| `no-form-event`            | No `FormEvent`, which React's types deprecate. Use the element's own event type, like `SubmitEvent<HTMLFormElement>`.                                                                                                                                                                     |
| `no-inline-handler-bodies` | A function written in a JSX prop is one expression, like `onClick={() => setOpen(false)}`, never a `{ … }` body. Anything bigger is a named `handle…` function.                                                                                                                           |
| `map-items-as-components`  | An HTML element rendered in a `.map()` has no inline handlers of its own: make the item a sub-component. Handlers passed to components, like `<Row onSelect={…} />`, pass.                                                                                                                |

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

## Adding a rule

1. Add it to `RULES` in [`src/rules.mjs`](src/rules.mjs): an id, a one-line description and fix,
   which files it applies to, and a check that returns each problem's node and a short message.
2. Add tests in `tests/rules.test.ts`.
3. Add a row for it to [What it checks](#what-it-checks), under the files it applies to: what it
   flags and what it lets through.
4. Run `pnpm build` and commit `dist/cleaner.cjs` with the change. Other repositories run the
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
