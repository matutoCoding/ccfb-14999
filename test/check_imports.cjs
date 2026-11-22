// 临时跨文件引用检查器
const fs = require('fs')
const path = require('path')
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
const root = path.resolve(__dirname, '..')
const files = walk(path.join(root, 'src')).filter((f) => f.endsWith('.ts'))
const exported = new Map()
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const names = new Set()
  for (const m of src.matchAll(/export (?:const|function|class|interface|type) ([A-Za-z0-9_]+)/g)) {
    names.add(m[1])
  }
  exported.set(f.split(path.sep).join('/'), names)
}
let problems = 0
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(/import \{([^}]+)\} from '(\.\.?\/[^']+)'/g)) {
    const spec = m[2]
    const base = path.normalize(path.join(path.dirname(f), spec)).split(path.sep).join('/')
    const target = exported.get(base)
    if (!target) {
      console.log('MISSING FILE', f, '->', spec)
      problems++
      continue
    }
    for (let raw of m[1].split(',')) {
      raw = raw.trim()
      if (!raw) continue
      const name = raw.replace(/^type\s*/, '').split(/\s+as\s+/)[0].trim()
      if (!target.has(name)) {
        console.log('MISSING SYMBOL', name, 'in', spec, 'imported by', f)
        problems++
      }
    }
  }
}
console.log('cross-reference problems:', problems)
process.exit(problems ? 1 : 0)
