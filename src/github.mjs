/**
 * What the cleaner adds when it runs in GitHub Actions: an annotation on each problem's line, a
 * table in the job summary, and a `problems` output with the count.
 */
import { appendFileSync } from 'node:fs'
import { counts } from './cleaner.mjs'
import { RULES } from './rules.mjs'

// Workflow commands treat these characters as syntax, so they're percent-encoded.
// https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts
const escapeData = (s) => s.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
const escapeProperty = (s) => escapeData(s).replaceAll(':', '%3A').replaceAll(',', '%2C')

/**
 * An `::error` workflow command for each problem, which GitHub shows on that line of the file in
 * the pull request.
 *
 * @param {ReturnType<typeof import('./cleaner.mjs').checkFile>} problems
 */
export function annotations(problems) {
	return problems.map((p) => {
		const rule = RULES.find((r) => r.id === p.rule)
		const props = `file=${escapeProperty(p.path)},line=${p.line},col=${p.column},title=${escapeProperty(p.rule)}`

		return `::error ${props}::${escapeData(`${p.message}: ${rule.description} ${rule.fix}`)}`
	})
}

/** An `::error` workflow command that isn't tied to a file. */
export function errorCommand(message) {
	return `::error title=cleaner::${escapeData(message)}`
}

// Text in a Markdown table cell: `<name>` would otherwise be read as an HTML tag and vanish.
const cell = (s) =>
	s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('|', '\\|')
// Code spans show `<` as it is, so only the cell separator needs escaping.
const code = (s) => `\`${s.replaceAll('|', '\\|')}\``

/**
 * The job summary in Markdown: the count, a table of problems, and what each rule that fired
 * means and how to fix it.
 *
 * @param {ReturnType<typeof import('./cleaner.mjs').checkFile>} problems
 * @param {number} checked how many files were checked
 */
export function summary(problems, checked) {
	const { found, checked: checkedLine, clean } = counts(problems, checked)
	if (!problems.length) return `### Cleaner\n\n✔ ${clean}\n`
	const lines = [
		'### Cleaner',
		'',
		`✖ **${found}** (${checkedLine})`,
		'',
		'| File | Line | Problem | Rule |',
		'| --- | --- | --- | --- |',
		...problems.map(
			(p) =>
				`| ${code(p.path)} | ${p.line}:${p.column} | ${cell(p.message)} | ${code(p.rule)} |`
		),
		''
	]
	for (const id of new Set(problems.map((p) => p.rule))) {
		const rule = RULES.find((r) => r.id === id)
		lines.push(`**${code(id)}**: ${cell(rule.description)} ${cell(rule.fix)}`, '')
	}

	return lines.join('\n')
}

/**
 * Appends the job summary and the `problems` output to the files GitHub Actions reads them from.
 * Does nothing for either file when its variable isn't set.
 */
export function writeOutputs(problems, checked, env = process.env) {
	if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary(problems, checked))
	if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `problems=${problems.length}\n`)
}
