const {test} = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const {ESLint} = require('eslint')

const cwd = path.resolve(__dirname, '../../lib/std')
const eslint = new ESLint({cwd})

test('syntax lint includes tests and tooling outside the compiler project', async () => {
    for (const filePath of ['src/lint.test.ts', 'vitest.config.ts']) {
        const [result] = await eslint.lintText('export const value: number = 1', {filePath})
        assert.equal(result.errorCount, 0, JSON.stringify(result.messages))
    }
})

test('build output is ignored, while authored declarations remain checked', async () => {
    assert.equal(await eslint.isPathIgnored(path.join(cwd, 'dist/index.d.ts')), true)
    assert.equal(await eslint.isPathIgnored(path.join(cwd, 'src/index.d.ts')), false)
})

test('public namespace merging is supported without disabling source type checks', async () => {
    const [result] = await eslint.lintText(`
        export class Value {}
        export namespace Value { export const initial = 0 }
        export const unsafe: any = null
    `, {filePath: 'src/lint-fixture.ts'})
    const errors = result.messages.filter(message => message.severity === 2)
    assert.deepEqual(errors.map(message => message.ruleId), ['@typescript-eslint/no-explicit-any'])
})
