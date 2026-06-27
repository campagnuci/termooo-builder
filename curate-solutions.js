#!/usr/bin/env node
/**
 * curate-solutions.js
 *
 * A partir de uma lista de palavras (saída do extract-by-length.js, COM acentos)
 * e de uma lista de FREQUÊNCIA do PT-BR, seleciona um subconjunto de "soluções"
 * — as palavras mais conhecidas — para usar como respostas do Termo. Os palpites
 * válidos continuam sendo a lista inteira (isso aqui só escolhe as RESPOSTAS).
 *
 * Por quê frequência? Medindo as soluções reais do Term.ooo (Pf), 93,5% estão
 * num top‑50k de frequência (vs 21,2% das palavras "palpite‑só"). Ou seja, o
 * critério de "solução" é familiaridade/frequência, não morfologia.
 *
 * Lista de frequência (baixe uma vez):
 *   curl -fsSL -o freq_pt_br_50k.txt \
 *     https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/pt_br/pt_br_50k.txt
 *   (formato: "palavra contagem" por linha, ordenada da mais frequente p/ a menos)
 *
 * Uso:
 *   node curate-solutions.js --palavras=palavras-6.txt --freq=freq_pt_br_50k.txt [opções]
 *
 * Critério de corte (escolha UM; padrão: --max-rank=10000):
 *   --max-rank=<R>   Mantém palavras com rank de frequência <= R (1 = mais comum)
 *   --top=<N>        Mantém as N palavras mais frequentes (que existam na lista)
 *   --present-only   Mantém TODAS que aparecem na lista de frequência (qualquer rank)
 *
 * Saída:
 *   --out=<arquivo>  Lista curada, COM acento, ordenada da mais p/ menos comum
 *                    (padrão: solucoes-<tamanho>.txt). Pronta p/ o build-termo-words.js --solucoes
 */

const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const getFlag = (name) => {
  const p = `--${name}=`
  const hit = args.find((a) => a.startsWith(p))
  return hit ? hit.slice(p.length) : null
}
const has = (name) => args.includes(`--${name}`)

const palavrasFile = path.resolve(getFlag('palavras') || getFlag('in') || 'palavras-6.txt')
const freqFile = path.resolve(getFlag('freq') || 'freq_pt_br_50k.txt')

for (const [label, f] of [['palavras', palavrasFile], ['frequência', freqFile]]) {
  if (!fs.existsSync(f)) {
    console.error(`❌ Arquivo de ${label} não encontrado: ${f}`)
    if (label === 'frequência') {
      console.error(`   Baixe com:\n   curl -fsSL -o freq_pt_br_50k.txt https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/pt_br/pt_br_50k.txt`)
    }
    process.exit(1)
  }
}

// Normalização idêntica ao jogo (e ao extract/build).
const normalize = (s) => s.normalize('NFD').replace(/[^\w]/g, '').toLowerCase()

function readLines(file) {
  let raw = fs.readFileSync(file, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

// Mapa de frequência: normalizado -> melhor (menor) rank. 1 = mais comum.
const rank = new Map()
readLines(freqFile).forEach((line, i) => {
  const w = normalize(line.split(/\s+/)[0])
  if (w && !rank.has(w)) rank.set(w, i + 1)
})

// Palavras candidatas (com acento). Deduplica por forma normalizada.
const words = readLines(palavrasFile)
const length = (() => {
  const counts = {}
  for (const w of words) counts[normalize(w).length] = (counts[normalize(w).length] || 0) + 1
  return Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0)
})()

// Critério de corte
const maxRank = getFlag('max-rank') ? Number(getFlag('max-rank')) : null
const top = getFlag('top') ? Number(getFlag('top')) : null
const presentOnly = has('present-only')
// padrão
const effectiveMaxRank = maxRank ?? (top || presentOnly ? null : 10000)

const seen = new Set()
let candidates = []
for (const display of words) {
  const norm = normalize(display.toLowerCase())
  if (norm.length !== length || seen.has(norm)) continue
  const r = rank.get(norm)
  if (r === undefined) continue // não está na lista de frequência → descartada
  seen.add(norm)
  candidates.push({ display: display.toLowerCase(), norm, r })
}

candidates.sort((a, b) => a.r - b.r) // mais comum primeiro

let chosen = candidates
if (effectiveMaxRank != null) chosen = candidates.filter((c) => c.r <= effectiveMaxRank)
else if (top != null) chosen = candidates.slice(0, top)
// present-only => todas as candidatas (já filtradas por estarem na lista)

const NUMBER_NAMES = { 4: 'quatro', 5: 'cinco', 6: 'seis', 7: 'sete', 8: 'oito', 9: 'nove', 10: 'dez' }
const outFile = path.resolve(
  getFlag('out') || `solucoes-${NUMBER_NAMES[length] || length}.txt`
)
fs.writeFileSync(outFile, chosen.map((c) => c.display).join('\n') + (chosen.length ? '\n' : ''), 'utf8')

// Estatísticas
const fmt = (n) => n.toLocaleString('pt-BR')
const criterio = effectiveMaxRank != null ? `rank <= ${effectiveMaxRank}` : top != null ? `top ${top}` : 'todas presentes na lista'
console.log(`📖 Palavras (${length} letras): ${fmt(words.length)}  •  na lista de frequência: ${fmt(candidates.length)}`)
console.log(`✂️  Critério: ${criterio}`)
console.log(`✅ Soluções selecionadas: ${fmt(chosen.length)}`)
if (chosen.length) {
  console.log(`   mais comuns: ${chosen.slice(0, 8).map((c) => c.display).join(', ')}`)
  console.log(`   menos comuns (no corte): ${chosen.slice(-8).map((c) => c.display).join(', ')}`)
}
console.log(`💾 Salvo em: ${outFile}`)
console.log(`\nPróximo passo:\n   node build-termo-words.js ${path.basename(palavrasFile)} --solucoes=${path.basename(outFile)}`)
