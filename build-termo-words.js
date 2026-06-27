#!/usr/bin/env node
/**
 * build-termo-words.js
 *
 * Converte a saída do `extract-by-length.js` (uma palavra por linha, COM acentos)
 * num módulo TypeScript pronto para um Termo de tamanho fixo, 1 tabuleiro
 * (sem Dueto/Quarteto). Faz os mesmos passos do `termooo/extract-words.js`, mas
 * a partir de uma lista de palavras simples em vez do bundle ofuscado.
 *
 * Gera (1 arquivo) com 4 exports:
 *   - <prefixo>Solutions   string[]              palavras-resposta, COM acento
 *   - <prefixo>Allowed     string[]              palpites válidos, NORMALIZADOS (sem acento, minúsculo)
 *   - <prefixo>AllowedSet  Set<string>           o mesmo, para validação O(1)
 *   - <prefixo>AccentMap   Record<string,string> normalizado -> com acento (só quando difere)
 *
 * Uso:
 *   node build-termo-words.js [arquivo-entrada] [opções]
 *
 * Opções:
 *   --in=<arquivo>        Lista de entrada (padrão: palavras-6.txt). Use a saída do
 *                         extract-by-length.js SEM --sem-acentos (precisamos dos acentos).
 *   --solucoes=<arquivo>  Lista CURADA de soluções (subconjunto). Se omitido, as soluções
 *                         são TODAS as palavras. Soluções entram automaticamente no "Allowed"
 *                         (como o original faz: toda solução também é palpite válido).
 *   --out=<arquivo>       Saída .ts (padrão: termooo/src/game/words-<prefixo>.ts)
 *   --prefixo=<nome>      Prefixo das variáveis (padrão: nome do número — 6=seis, 7=sete… ou lenN)
 *   --tamanho=<n>         Força o tamanho em letras (padrão: detectado da lista)
 *
 * Exemplos:
 *   node extract-by-length.js 6 --sem-nomes-proprios --out=palavras-6.txt
 *   node build-termo-words.js palavras-6.txt
 *   node build-termo-words.js palavras-6.txt --solucoes=respostas-6.txt --out=termooo/src/game/words-seis.ts
 */

const fs = require('fs')
const path = require('path')

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const positionals = args.filter((a) => !a.startsWith('--'))
function getFlagValue(name) {
  const prefix = `--${name}=`
  const hit = args.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

const inputFile = path.resolve(getFlagValue('in') || positionals[0] || 'palavras-6.txt')
const solutionsFile = getFlagValue('solucoes') ? path.resolve(getFlagValue('solucoes')) : null

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Arquivo de entrada não encontrado: ${inputFile}
   Gere primeiro, por ex.: node extract-by-length.js 6 --sem-nomes-proprios --out=palavras-6.txt`)
  process.exit(1)
}
if (solutionsFile && !fs.existsSync(solutionsFile)) {
  console.error(`❌ Arquivo de soluções não encontrado: ${solutionsFile}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Normalização IDÊNTICA ao jogo (src/lib/utils.ts -> normalizeString):
// NFD, remove tudo que não é \w (tira acentos/cedilha/pontuação), minúsculas.
function normalize(s) {
  return s.normalize('NFD').replace(/[^\w]/g, '').toLowerCase()
}

function readWords(file) {
  let raw = fs.readFileSync(file, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1) // BOM
  return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

const NUMBER_NAMES = { 4: 'quatro', 5: 'cinco', 6: 'seis', 7: 'sete', 8: 'oito', 9: 'nove', 10: 'dez' }

// Formata array de strings em literal TS (10 por linha, como o extract-words.js).
function arrayLiteral(words) {
  if (words.length === 0) return '[]'
  const lines = []
  for (let i = 0; i < words.length; i += 10) {
    lines.push('  ' + words.slice(i, i + 10).map((w) => `'${w}'`).join(', ') + ',')
  }
  return `[\n${lines.join('\n')}\n]`
}

// Formata objeto em literal TS (5 por linha). Chaves normalizadas ([a-z0-9_]) são
// identificadores válidos; valores (com acento) não contêm aspas simples.
function objectLiteral(obj) {
  const entries = Object.entries(obj)
  if (entries.length === 0) return '{}'
  const lines = []
  for (let i = 0; i < entries.length; i += 5) {
    lines.push('  ' + entries.slice(i, i + 5).map(([k, v]) => `${k}: '${v}'`).join(', ') + ',')
  }
  return `{\n${lines.join('\n')}\n}`
}

// ---------------------------------------------------------------------------
// Leitura + detecção de tamanho
// ---------------------------------------------------------------------------
const rawWords = readWords(inputFile)
const letterCount = (w) => normalize(w).length

let length = Number.parseInt(getFlagValue('tamanho'), 10)
if (!Number.isInteger(length) || length < 1) {
  // tamanho = o mais frequente na lista
  const counts = {}
  for (const w of rawWords) {
    const n = letterCount(w)
    counts[n] = (counts[n] || 0) + 1
  }
  length = Number(
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  )
}

const prefix = getFlagValue('prefixo') || NUMBER_NAMES[length] || `len${length}`
const outFile = path.resolve(
  // os scripts moram em termooo-builder/ → o projeto real é ../termooo
  getFlagValue('out') || path.join(__dirname, '..', 'termooo', 'src', 'game', `words-${prefix}.ts`)
)

// ---------------------------------------------------------------------------
// Monta as estruturas
// ---------------------------------------------------------------------------
const accentMap = {} // normalized -> display (apenas quando diferem)
const allowedSet = new Set() // normalized
const allowed = [] // normalized (único)

function addAllowed(display) {
  const norm = normalize(display)
  if (norm.length !== length) return
  if (!allowedSet.has(norm)) {
    allowedSet.add(norm)
    allowed.push(norm)
  }
  if (display !== norm && !(norm in accentMap)) accentMap[norm] = display // 1ª forma acentuada vence
}

let skipped = 0
for (const w of rawWords) {
  const display = w.toLowerCase()
  if (letterCount(display) !== length) {
    skipped++
    continue
  }
  addAllowed(display)
}

// ---- Soluções ----
// Padrão: todas as palavras (deduplicadas por forma normalizada), COM acento.
// Com --solucoes: usa só a lista curada; cada solução também vira palpite válido.
const solutions = []
const seenSolution = new Set()
function addSolution(display) {
  display = display.toLowerCase()
  const norm = normalize(display)
  if (norm.length !== length || seenSolution.has(norm)) return
  seenSolution.add(norm)
  addAllowed(display) // garante solução ⊆ allowed
  solutions.push(accentMap[norm] || display) // prefere a forma com acento, se houver
}

const solutionSource = solutionsFile ? readWords(solutionsFile) : rawWords
for (const w of solutionSource) addSolution(w)

allowed.sort((a, b) => a.localeCompare(b, 'pt-BR'))
const accentSorted = Object.keys(accentMap)
  .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  .reduce((acc, k) => ((acc[k] = accentMap[k]), acc), {})

// ---------------------------------------------------------------------------
// Gera o arquivo .ts
// ---------------------------------------------------------------------------
const inputBase = path.basename(inputFile)
const content = `// src/game/words-${prefix}.ts
// Gerado automaticamente por build-termo-words.js a partir de "${inputBase}".
// Termo de ${length} letras, 1 tabuleiro (sem Dueto/Quarteto).
//
//  - ${prefix}Solutions: respostas possíveis (COM acento).
//  - ${prefix}Allowed / ${prefix}AllowedSet: palpites válidos (NORMALIZADOS).
//  - ${prefix}AccentMap: forma normalizada -> forma com acento (para revelar a resposta).

export const ${prefix}Solutions: string[] = ${arrayLiteral(solutions)}

export const ${prefix}Allowed: string[] = ${arrayLiteral(allowed)}

export const ${prefix}AllowedSet: Set<string> = new Set(${prefix}Allowed)

export const ${prefix}AccentMap: Record<string, string> = ${objectLiteral(accentSorted)}
`

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, content, 'utf8')

// ---------------------------------------------------------------------------
// Estatísticas
// ---------------------------------------------------------------------------
const fmt = (n) => n.toLocaleString('pt-BR')
console.log(`📖 Entrada: ${inputFile}`)
console.log(`🔤 Tamanho detectado: ${length} letras  •  prefixo: "${prefix}"`)
if (skipped) console.log(`   (ignoradas ${fmt(skipped)} linha(s) de tamanho diferente)`)
console.log(`✅ Soluções: ${fmt(solutions.length)}${solutionsFile ? ' (lista curada)' : ' (todas)'}`)
console.log(`✅ Palpites válidos (Allowed): ${fmt(allowed.length)}`)
console.log(`✅ Mapeamentos de acento: ${fmt(Object.keys(accentSorted).length)}`)
console.log(`💾 Salvo em: ${outFile}`)
