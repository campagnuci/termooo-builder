#!/usr/bin/env node
/**
 * extract-by-length.js
 *
 * Extrai do dicionário `br-utf8.txt` todas as palavras com EXATAMENTE N letras
 * e grava num novo arquivo.
 *
 * Uso:
 *   node extract-by-length.js <tamanho> [opções]
 *
 *   <tamanho>   Número de letras (inteiro >= 1). Ex.: 6
 *
 * Opções:
 *   --in=<arquivo>         Dicionário de entrada (padrão: br-utf8.txt ao lado do script)
 *   --out=<arquivo>        Arquivo de saída (padrão: palavras-<tamanho>.txt na pasta do dicionário)
 *   --sem-acentos          Remove acentos na saída (ex.: "ábaco" -> "abaco")
 *   --minusculas           Converte a saída para minúsculas
 *   --sem-nomes-proprios   Ignora palavras que começam com maiúscula (nomes próprios)
 *
 * Regras de contagem:
 *   - Acento NÃO conta como letra extra: "açúcar" = 6 letras, "ábaco" = 5.
 *   - "ç" conta como 1 letra.
 *   - Entradas com hífen, espaço, número ou apóstrofo são ignoradas
 *     (ex.: "guarda-chuva" não é tratada como uma palavra única).
 *   - Duplicatas (após as transformações) são removidas, preservando a ordem.
 *
 * Exemplos:
 *   node extract-by-length.js 5
 *   node extract-by-length.js 6 --out=seis.txt --sem-nomes-proprios
 *   node extract-by-length.js 5 --sem-acentos --minusculas   # útil p/ palpites do Termo
 */

const fs = require('fs')
const path = require('path')

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--') && !a.includes('=')))
const positionals = args.filter((a) => !a.startsWith('--'))

function getFlagValue(name) {
  const prefix = `--${name}=`
  const hit = args.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

const length = Number.parseInt(positionals[0], 10)

if (!Number.isInteger(length) || length < 1) {
  console.error(`Uso: node extract-by-length.js <tamanho> [opções]

  <tamanho>                Número de letras (inteiro >= 1). Ex.: 6

Opções:
  --in=<arquivo>           Dicionário de entrada (padrão: br-utf8.txt ao lado do script)
  --out=<arquivo>          Arquivo de saída (padrão: palavras-<tamanho>.txt)
  --sem-acentos            Remove acentos na saída (ex.: "ábaco" -> "abaco")
  --minusculas             Converte a saída para minúsculas
  --sem-nomes-proprios     Ignora palavras que começam com letra maiúscula

Observação: acentos não contam como letra extra (ç conta como 1 letra);
palavras com hífen, espaço, número ou apóstrofo são ignoradas.`)
  process.exit(1)
}

const inputFile = path.resolve(getFlagValue('in') || path.join(__dirname, 'br-utf8.txt'))
const outputFile = path.resolve(
  getFlagValue('out') || path.join(path.dirname(inputFile), `palavras-${length}.txt`)
)
const stripAccents = flags.has('--sem-acentos')
const toLower = flags.has('--minusculas')
const skipProper = flags.has('--sem-nomes-proprios')

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Arquivo de entrada não encontrado: ${inputFile}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Apenas letras (sem hífen, espaço, número, apóstrofo). Em NFC, cada letra
// acentuada é um único code point, então \p{L} cobre á, ç, ã, etc.
const ONLY_LETTERS = /^\p{L}+$/u

function removeAccents(s) {
  // Decompõe e remove os sinais combinantes (acentos/cedilha).
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

function transform(word) {
  let w = word
  if (stripAccents) w = removeAccents(w)
  if (toLower) w = w.toLowerCase()
  return w
}

// ---------------------------------------------------------------------------
// Processamento
// ---------------------------------------------------------------------------
console.log(`📖 Lendo: ${inputFile}`)

let raw = fs.readFileSync(inputFile, 'utf8')
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1) // remove BOM, se houver

const lines = raw.split(/\r?\n/)
const seen = new Set()
const result = []
let scanned = 0

for (const line of lines) {
  const word = line.trim()
  if (!word) continue
  scanned++

  const nfc = word.normalize('NFC')
  if (!ONLY_LETTERS.test(nfc)) continue // ignora hífen/espaço/número/etc.
  if ([...nfc].length !== length) continue // conta letras (acento = 1)
  if (skipProper && /^\p{Lu}/u.test(nfc)) continue // pula nomes próprios

  const out = transform(word)
  if (seen.has(out)) continue
  seen.add(out)
  result.push(out)
}

fs.writeFileSync(outputFile, result.length ? result.join('\n') + '\n' : '', 'utf8')

console.log(
  `✅ ${result.length.toLocaleString('pt-BR')} palavra(s) de ${length} letra(s) ` +
    `(de ${scanned.toLocaleString('pt-BR')} analisadas)`
)
console.log(`💾 Salvo em: ${outputFile}`)
