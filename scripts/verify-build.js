'use strict'

const fs = require('node:fs')
const path = require('node:path')

const outputDirectory = path.resolve(__dirname, '..', 'lib')
const unresolvedBareAlias = /(?:require|import)\(\s*['"]@['"]\s*\)/

function collectJavaScriptFiles(directory) {
    const files = []
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
            files.push(...collectJavaScriptFiles(entryPath))
        } else if (/\.(?:c|m)?js$/.test(entry.name)) {
            files.push(entryPath)
        }
    }
    return files
}

const unresolvedFiles = collectJavaScriptFiles(outputDirectory).filter((file) =>
    unresolvedBareAlias.test(fs.readFileSync(file, 'utf8'))
)

if (unresolvedFiles.length > 0) {
    const relativeFiles = unresolvedFiles.map((file) => path.relative(process.cwd(), file))
    throw new Error(`Unresolved runtime aliases found in build output:\n${relativeFiles.join('\n')}`)
}
