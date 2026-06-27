#!/usr/bin/env node
/**
 * criar-modo-termo.js — assistente interativo (estilo create-*)
 *
 * Do dicionário ao .ts, num fluxo só:
 *   1. lê o br-utf8.txt e extrai as palavras de X letras (palpites válidos);
 *   2. cura as SOLUÇÕES por frequência (fonte à escolha);
 *   3. gera src/game/words-<prefixo>.ts pronto para o projeto.
 *
 * UI com `prompts` (menus/validação) + `picocolors` (cores). Sem rede além do
 * download opcional da lista de frequência.
 *
 * Rode:  pnpm start   (ou  node criar-modo-termo.js)
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
const prompts = require('prompts')
const pc = require('picocolors')

// ---------------------------------------------------------------------------
// Constantes / helpers
// ---------------------------------------------------------------------------
const ONLY_LETTERS = /^\p{L}+$/u
const NUMBER_NAMES = { 4: 'quatro', 5: 'cinco', 6: 'seis', 7: 'sete', 8: 'oito', 9: 'nove', 10: 'dez' }
const FREQ_URL =
  'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/pt_br/pt_br_50k.txt'
const DEFAULT_FREQ = path.join(__dirname, 'freq_pt_br_50k.txt')

const normalize = (s) => s.normalize('NFD').replace(/[^\w]/g, '').toLowerCase()
const fmt = (n) => n.toLocaleString('pt-BR')

function readLines(file) {
  let raw = fs.readFileSync(file, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

function downloadFile(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('muitos redirecionamentos'))
    https
      .get(url, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume()
          return resolve(downloadFile(res.headers.location, dest, redirects + 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode}`))
        }
        const out = fs.createWriteStream(dest)
        res.pipe(out)
        out.on('finish', () => out.close(() => resolve()))
        out.on('error', reject)
      })
      .on('error', reject)
  })
}

// Carrega a lista de frequência -> Map(normalizado -> rank). Tolerante a dois
// formatos: "palavra contagem" (HermitDave) e "rank<TAB>palavra<TAB>freq" (Leipzig).
// Em ambos as linhas vêm ordenadas da mais frequente p/ a menos, então o rank é
// a ordem da linha; a "palavra" é o primeiro token que contém letra.
function loadFreq(file) {
  const rank = new Map()
  readLines(file).forEach((line, i) => {
    const tok = line.split(/\s+/).find((t) => /\p{L}/u.test(t))
    if (!tok) return
    const w = normalize(tok)
    if (w && !rank.has(w)) rank.set(w, i + 1)
  })
  return rank
}

function arrayLiteral(words) {
  if (!words.length) return '[]'
  const lines = []
  for (let i = 0; i < words.length; i += 10) {
    lines.push('  ' + words.slice(i, i + 10).map((w) => `'${w}'`).join(', ') + ',')
  }
  return `[\n${lines.join('\n')}\n]`
}

function objectLiteral(obj) {
  const entries = Object.entries(obj)
  if (!entries.length) return '{}'
  const lines = []
  for (let i = 0; i < entries.length; i += 5) {
    lines.push('  ' + entries.slice(i, i + 5).map(([k, v]) => `${k}: '${v}'`).join(', ') + ',')
  }
  return `{\n${lines.join('\n')}\n}`
}

const onCancel = () => {
  console.log(pc.yellow('\nCancelado.'))
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Assistente
// ---------------------------------------------------------------------------
async function main() {
  console.log(pc.bold(pc.green('\n🟩 Gerador de modo do Termo')) + pc.dim('  (br-utf8 → curadoria → .ts)\n'))

  // 1) dicionário ------------------------------------------------------------
  let dict = path.join(__dirname, 'br-utf8.txt')
  if (!fs.existsSync(dict)) {
    const r = await prompts({ type: 'text', name: 'p', message: 'Caminho do dicionário (br-utf8.txt)', initial: 'br-utf8.txt' }, { onCancel })
    dict = path.resolve(r.p)
  }
  if (!fs.existsSync(dict)) throw new Error(`Dicionário não encontrado: ${dict}`)

  // 2) tamanho + nomes próprios ----------------------------------------------
  const baseAnswers = await prompts(
    [
      { type: 'number', name: 'length', message: 'Tamanho da palavra (nº de letras)', initial: 6, min: 1, validate: (v) => v >= 1 || 'Informe um inteiro >= 1' },
      { type: 'confirm', name: 'skipProper', message: 'Ignorar nomes próprios (palavras com maiúscula)?', initial: true },
    ],
    { onCancel }
  )
  const { length, skipProper } = baseAnswers

  // --- extração -------------------------------------------------------------
  console.log(pc.dim('\n⏳ Extraindo palavras…'))
  const byNorm = new Map() // normalizado -> forma exibida (prefere a com acento)
  let total = 0
  for (const raw of readLines(dict)) {
    const nfc = raw.normalize('NFC')
    if (!ONLY_LETTERS.test(nfc)) continue
    if ([...nfc].length !== length) continue
    if (skipProper && /^\p{Lu}/u.test(nfc)) continue
    total++
    const display = raw.toLowerCase()
    const n = normalize(display)
    if (!n) continue
    if (!byNorm.has(n)) byNorm.set(n, display)
    else if (byNorm.get(n) === n && display !== n) byNorm.set(n, display)
  }
  if (byNorm.size === 0) throw new Error(`Nenhuma palavra de ${length} letras encontrada.`)
  console.log(pc.green(`  ✓ ${fmt(total)} palavras de ${length} letras `) + pc.dim(`(${fmt(byNorm.size)} normalizadas = palpites válidos)`))

  // 3) fonte de frequência ----------------------------------------------------
  let rank = null
  const { curate } = await prompts({ type: 'confirm', name: 'curate', message: 'Curar as SOLUÇÕES por frequência (recomendado)?', initial: true }, { onCancel })
  if (curate) {
    const choices = []
    if (fs.existsSync(DEFAULT_FREQ)) choices.push({ title: `Usar ${path.basename(DEFAULT_FREQ)} (já presente)`, value: 'existing' })
    choices.push({ title: 'Baixar HermitDave 2018 (OpenSubtitles pt-br, 50k)', value: 'download' })
    choices.push({ title: 'Usar arquivo local (ex.: lista do Leipzig)', value: 'local' })
    const { src } = await prompts({ type: 'select', name: 'src', message: 'Fonte de frequência', choices, initial: 0 }, { onCancel })

    let freqPath = null
    if (src === 'existing') freqPath = DEFAULT_FREQ
    else if (src === 'download') {
      console.log(pc.dim('  ⏳ baixando…'))
      try {
        await downloadFile(FREQ_URL, DEFAULT_FREQ)
        freqPath = DEFAULT_FREQ
        console.log(pc.green(`  ✓ baixada em ${DEFAULT_FREQ}`))
      } catch (e) {
        console.log(pc.red(`  ✗ falha no download: ${e.message}`))
      }
    } else {
      const r = await prompts({ type: 'text', name: 'p', message: 'Caminho do arquivo de frequência' }, { onCancel })
      freqPath = r.p ? path.resolve(r.p) : null
    }

    if (freqPath && fs.existsSync(freqPath)) rank = loadFreq(freqPath)
    else console.log(pc.yellow('  ⚠ sem lista de frequência — as soluções serão TODAS as palavras.'))
  }

  // --- escolha das soluções --------------------------------------------------
  let solutions
  if (rank) {
    const present = [...byNorm.entries()]
      .filter(([n]) => rank.has(n))
      .map(([n, display]) => ({ n, display, r: rank.get(n) }))
      .sort((a, b) => a.r - b.r)

    console.log(pc.bold(`\n  Distribuição por frequência (${fmt(present.length)} presentes):`))
    for (const k of [1000, 2000, 3000, 5000, 10000, 20000]) {
      console.log(pc.dim(`    rank <= ${String(fmt(k)).padStart(6)} → ${fmt(present.filter((p) => p.r <= k).length)}`))
    }
    console.log(pc.dim(`    todas presentes  → ${fmt(present.length)}`))

    const { mode } = await prompts(
      {
        type: 'select',
        name: 'mode',
        message: 'Critério das soluções',
        choices: [
          { title: 'Rank máximo (recomendado)', value: 'rank' },
          { title: 'Top N mais frequentes', value: 'top' },
          { title: 'Todas presentes na lista', value: 'all' },
        ],
        initial: 0,
      },
      { onCancel }
    )

    let chosen
    if (mode === 'top') {
      const { n } = await prompts({ type: 'number', name: 'n', message: 'Quantas (N)', initial: 1500, min: 1 }, { onCancel })
      chosen = present.slice(0, n)
    } else if (mode === 'all') {
      chosen = present
    } else {
      const { r } = await prompts({ type: 'number', name: 'r', message: 'Rank máximo', initial: 10000, min: 1 }, { onCancel })
      chosen = present.filter((p) => p.r <= r)
    }
    solutions = chosen.map((c) => c.display)
    console.log(pc.green(`  ✓ ${fmt(solutions.length)} soluções selecionadas`))
    if (solutions.length) {
      console.log(pc.dim(`    + comuns: ${chosen.slice(0, 6).map((c) => c.display).join(', ')} … - comuns: ${chosen.slice(-4).map((c) => c.display).join(', ')}`))
    }
  } else {
    solutions = [...byNorm.values()]
    console.log(pc.yellow(`  soluções = todas (${fmt(solutions.length)})`))
  }

  // 4) prefixo + saída --------------------------------------------------------
  const defPrefix = NUMBER_NAMES[length] || `len${length}`
  const { prefix: pIn } = await prompts({ type: 'text', name: 'prefix', message: 'Prefixo das variáveis', initial: defPrefix }, { onCancel })
  const prefix = pIn || defPrefix
  // os scripts moram em termooo-builder/ → o projeto real é ../termooo
  const defOut = path.join(__dirname, '..', 'termooo', 'src', 'game', `words-${prefix}.ts`)
  const { out } = await prompts({ type: 'text', name: 'out', message: 'Arquivo de saída (.ts)', initial: path.relative(process.cwd(), defOut) || defOut }, { onCancel })
  const outFile = path.resolve(out)
  if (fs.existsSync(outFile)) {
    const { ow } = await prompts({ type: 'confirm', name: 'ow', message: `Já existe ${outFile}. Sobrescrever?`, initial: false }, { onCancel })
    if (!ow) {
      console.log(pc.yellow('\nCancelado.'))
      return
    }
  }

  // --- monta e grava o .ts ---------------------------------------------------
  const accentMap = {}
  const allowed = []
  for (const [n, display] of byNorm) {
    allowed.push(n)
    if (display !== n) accentMap[n] = display
  }
  allowed.sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const accentSorted = Object.keys(accentMap)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .reduce((acc, k) => ((acc[k] = accentMap[k]), acc), {})

  const content = `// src/game/words-${prefix}.ts
// Gerado pelo assistente criar-modo-termo.js (a partir de "${path.basename(dict)}").
// Termo de ${length} letras, 1 tabuleiro (sem Dueto/Quarteto).
//
//  - ${prefix}Solutions: respostas possíveis (COM acento).
//  - ${prefix}Allowed / ${prefix}AllowedSet: palpites válidos (NORMALIZADOS).
//  - ${prefix}AccentMap: forma normalizada -> forma com acento.

export const ${prefix}Solutions: string[] = ${arrayLiteral(solutions)}

export const ${prefix}Allowed: string[] = ${arrayLiteral(allowed)}

export const ${prefix}AllowedSet: Set<string> = new Set(${prefix}Allowed)

export const ${prefix}AccentMap: Record<string, string> = ${objectLiteral(accentSorted)}
`
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, content, 'utf8')

  // 5) listas .txt opcionais --------------------------------------------------
  const { saveTxt } = await prompts({ type: 'confirm', name: 'saveTxt', message: 'Salvar também as listas .txt (palpites/soluções)?', initial: false }, { onCancel })
  if (saveTxt) {
    const dir = path.dirname(outFile)
    fs.writeFileSync(path.join(dir, `palpites-${prefix}.txt`), [...byNorm.values()].join('\n') + '\n', 'utf8')
    fs.writeFileSync(path.join(dir, `solucoes-${prefix}.txt`), solutions.join('\n') + '\n', 'utf8')
    console.log(pc.dim(`  ✓ palpites-${prefix}.txt / solucoes-${prefix}.txt`))
  }

  // --- resumo ---------------------------------------------------------------
  console.log(pc.bold(pc.green('\n✅ Pronto!')))
  console.log(`  Arquivo: ${pc.bold(outFile)}`)
  console.log(`  ${prefix}Solutions = ${fmt(solutions.length)}  •  ${prefix}Allowed = ${fmt(allowed.length)}  •  ${prefix}AccentMap = ${fmt(Object.keys(accentSorted).length)}`)
  console.log(pc.yellow(`\n⚠ O .ts é só o dado. Para JOGAR o modo de ${length} letras ainda falta o wiring:`))
  console.log(pc.dim('  1) types.ts — incluir o modo em GameMode'))
  console.log(pc.dim(`  2) mode-config.ts — MODE_CONFIG usando ${prefix}Solutions/${prefix}Allowed/${prefix}AllowedSet (+ wordLength)`))
  console.log(pc.dim('  3) engine.ts — trocar os "5" fixos por wordLength'))
  console.log(pc.dim('  4) accent-map/getAccentedWord — consultar o AccentMap do modo'))
  console.log(pc.dim('  5) UI — tabuleiro/teclado/share por wordLength; rota e aba do modo\n'))
}

if (require.main === module) {
  main().catch((e) => {
    console.error(pc.red(`\n❌ ${e.message}`))
    process.exit(1)
  })
}

module.exports = { main }
