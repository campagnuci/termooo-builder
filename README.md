# termooo-builder

Gerador de **listas de palavras** (palpites válidos + soluções curadas) para os modos do clone do [Term.ooo](../termooo). A partir de um dicionário genérico do português (`br-utf8.txt`), ele extrai palavras de um tamanho `X`, **cura as soluções por frequência de uso** e emite um módulo TypeScript (`words-<modo>.ts`) pronto para ser plugado no jogo.

Foi com este pacote que nasceu o **Modo 6** (palavras de 6 letras) do clone.

---

## 📋 Índice

- [Por que isso existe](#-por-que-isso-existe)
- [O conceito-chave: palpites × soluções](#-o-conceito-chave-palpites--soluções)
- [Requisitos](#-requisitos)
- [Início rápido (assistente)](#-início-rápido-assistente)
- [Uso avançado: os 3 scripts](#-uso-avançado-os-3-scripts)
- [Como funciona (normalização e contagem)](#-como-funciona-normalização-e-contagem)
- [Dados de frequência](#-dados-de-frequência)
- [Formato do arquivo `.ts` gerado](#-formato-do-arquivo-ts-gerado)
- [Integração no projeto](#-integração-no-projeto-termooo)
- [Arquivos do diretório](#-arquivos-do-diretório)
- [Notas e limitações](#-notas-e-limitações)

---

## 🎯 Por que isso existe

O Term.ooo original embute no próprio bundle dois dicionários **curados à mão** (lista de palpites + lista de soluções). Para criar modos novos — como o de 6 letras — não temos essa curadoria pronta. Este pacote reconstrói o mesmo tipo de dado **automaticamente** a partir de um dicionário público:

- **Dicionário de entrada:** `br-utf8.txt` — ~261 mil palavras do português, da coleção do [Prof. Paulo Feofiloff (IME-USP)](https://www.ime.usp.br/~pf/dicios/).
- **Saída:** um módulo `.ts` com palpites válidos, soluções e mapa de acentos no formato que o `mode-config.ts` do jogo consome.

---

## 💡 O conceito-chave: palpites × soluções

Todo modo tem **duas** listas, com papéis diferentes:

| Lista | O que é | Tamanho típico |
|-------|---------|----------------|
| **Palpites válidos** (`Allowed`) | Tudo que o jogo aceita você *digitar* | grande (todas as palavras do tamanho) |
| **Soluções** (`Solutions`) | O que pode ser a *resposta* do dia | pequeno (subconjunto "conhecido") |

**Por que as soluções são um subconjunto?** Medindo o jogo original: **93,5%** das soluções de 5 letras estão num top-50k de frequência, contra apenas **21,2%** das palavras que são só palpite. Ou seja, o critério do Term.ooo para "isto pode ser resposta" é **familiaridade / frequência de uso**, não morfologia. Reproduzimos exatamente isso: os palpites são todas as palavras do tamanho; as soluções são as **mais frequentes** (as que as pessoas realmente conhecem), filtradas por uma lista de frequência.

> Exemplo (Modo 6): das **12.230** palavras de 6 letras do `br-utf8.txt`, ficam **1.460** como soluções (corte em rank ≤ 10.000) — ordem de grandeza idêntica às ~1.442 soluções de 5 letras do original.

---

## 🔧 Requisitos

- **Node.js ≥ 22** (o assistente usa `node:readline` / `fs`; os scripts usam só APIs nativas)
- **pnpm** (para o assistente, que depende de `prompts` + `picocolors`)
- O dicionário **`br-utf8.txt`** presente nesta pasta (já incluído)

```bash
pnpm install   # instala prompts + picocolors (só p/ o assistente)
```

---

## 🚀 Início rápido (assistente)

A forma recomendada é o **assistente interativo** — faz tudo num fluxo só (extrair → curar → gerar `.ts`):

```bash
pnpm start          # ou: node criar-modo-termo.js
```

Ele pergunta, com defaults sensatos (Enter aceita):

1. **Tamanho** da palavra (ex.: 6)
2. **Ignorar nomes próprios?** (palavras com maiúscula)
3. **Curar por frequência?** → escolhe a fonte: usar a lista presente · **baixar** a do HermitDave (OpenSubtitles pt-br 50k) · ou apontar um **arquivo local** (ex.: Leipzig)
4. Mostra a **distribuição por rank** e deixa escolher o corte (rank máximo / top N / todas presentes)
5. **Prefixo** das variáveis (6 → `seis`) e **caminho de saída** (default `../termooo/src/game/words-<prefixo>.ts`, com confirmação se já existir)
6. Opcional: salvar as listas `.txt` (palpites/soluções) para inspeção

---

## 🛠️ Uso avançado: os 3 scripts

O assistente é só um orquestrador. Para uso não-interativo (CI, scripts, inspeção passo a passo), os três utilitários abaixo fazem cada etapa. Todos usam **apenas APIs nativas do Node** (sem dependências).

### Pipeline em 3 passos

```bash
# 1) palpites válidos = TODAS as palavras de 6 letras
node extract-by-length.js 6 --sem-nomes-proprios --out=palavras-6.txt

# 2) soluções = as mais frequentes/conhecidas
node curate-solutions.js --palavras=palavras-6.txt --freq=freq_pt_br_50k.txt --max-rank=10000

# 3) gera o módulo do jogo
node build-termo-words.js palavras-6.txt --solucoes=solucoes-seis.txt
#    → ../termooo/src/game/words-seis.ts
```

### `extract-by-length.js` — extrai palavras de N letras

```
node extract-by-length.js <tamanho> [opções]
```

| Opção | Descrição |
|-------|-----------|
| `<tamanho>` | Nº de letras (inteiro ≥ 1). **Obrigatório** |
| `--in=<arquivo>` | Dicionário de entrada (padrão: `br-utf8.txt`) |
| `--out=<arquivo>` | Saída (padrão: `palavras-<tamanho>.txt`) |
| `--sem-acentos` | Remove acentos na saída (`ábaco` → `abaco`) |
| `--minusculas` | Converte para minúsculas |
| `--sem-nomes-proprios` | Ignora palavras com inicial maiúscula |

Regras: **acento não conta como letra extra** (`açúcar` = 6); `ç` conta como 1; entradas com hífen, espaço, número ou apóstrofo são descartadas (não trata compostos como uma palavra só); duplicatas removidas.

### `curate-solutions.js` — seleciona soluções por frequência

```
node curate-solutions.js --palavras=<arq> --freq=<arq> [critério de corte]
```

| Opção | Descrição |
|-------|-----------|
| `--palavras=<arq>` | Lista de candidatas, **com acento** (padrão: `palavras-6.txt`) |
| `--freq=<arq>` | Lista de frequência (padrão: `freq_pt_br_50k.txt`) |
| `--max-rank=<R>` | Mantém palavras com rank ≤ R (**padrão: 10000**) |
| `--top=<N>` | Mantém as N mais frequentes |
| `--present-only` | Mantém todas que aparecem na lista de frequência |
| `--out=<arq>` | Saída (padrão: `solucoes-<nome>.txt`), ordenada da mais p/ menos comum |

### `build-termo-words.js` — gera o módulo `.ts`

```
node build-termo-words.js [arquivo-entrada] [opções]
```

| Opção | Descrição |
|-------|-----------|
| `[arquivo]` / `--in=<arq>` | Lista de palpites, com acento (padrão: `palavras-6.txt`) |
| `--solucoes=<arq>` | Lista curada de soluções. Se omitido, soluções = **todas** as palavras. As soluções entram automaticamente no `Allowed` (relação `soluções ⊆ palpites`) |
| `--out=<arq>` | Saída `.ts` (padrão: `../termooo/src/game/words-<prefixo>.ts`) |
| `--prefixo=<nome>` | Prefixo das variáveis (padrão: nome do número — 6→`seis`, 7→`sete`… ou `lenN`) |
| `--tamanho=<n>` | Força o tamanho (padrão: detectado da lista) |

---

## ⚙️ Como funciona (normalização e contagem)

- **Contagem de letras:** feita sobre a forma **NFC** (cada letra acentuada é 1 code point). Só palavras 100% letras (`\p{L}+`) entram — hífen/espaço/número/apóstrofo eliminam a entrada.
- **Normalização (idêntica ao jogo):** `s.normalize('NFD').replace(/[^\w]/g, '').toLowerCase()` — remove acentos/cedilha e baixa a caixa. É a mesma função do `src/lib/utils.ts` do `termooo`, garantindo que palpites batam na validação do jogo.
- **Palpites (`Allowed`):** formas **normalizadas**, únicas e ordenadas.
- **Soluções (`Solutions`):** formas **com acento** (a "cara" da resposta), deduplicadas pela forma normalizada.
- **`AccentMap`:** `normalizado → com acento`, só para palavras que têm acento.

---

## 📊 Dados de frequência

A curadoria precisa de uma lista de frequência (`palavra` ordenada da mais para a menos usada). Baixe uma vez:

```bash
curl -fsSL -o freq_pt_br_50k.txt \
  https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/pt_br/pt_br_50k.txt
```

O parser é **tolerante a dois formatos** (detecta a palavra como o primeiro token com letra; o rank é a ordem da linha):

- **HermitDave / OpenSubtitles:** `palavra contagem` (a usada por padrão)
- **Leipzig Corpora (Wortschatz):** `rank⇥palavra⇥frequência`

> ⚠️ **Sobre "frequência atual (2026)":** uma lista de frequência é *calculada* contando palavras num corpus. A lista padrão é de **2018** — e isso é proposital: texto da web pós-2021 está poluído por conteúdo gerado por IA (motivo pelo qual a lib `wordfreq` parou de atualizar). Para um jogo de palavras, a familiaridade do vocabulário comum praticamente não muda, então a de 2018 é mais que suficiente. Se quiser algo mais novo/alternativo, o [Leipzig Corpora](https://wortschatz.uni-leipzig.de/en/download/) tem listas PT-BR por ano/fonte — basta apontar o arquivo (`--freq=`), pois o parser já entende o formato deles.

---

## 📦 Formato do arquivo `.ts` gerado

Para um modo de prefixo `seis` (6 letras):

```ts
export const seisSolutions: string[]              // respostas possíveis (COM acento)
export const seisAllowed: string[]                // palpites válidos (NORMALIZADOS)
export const seisAllowedSet: Set<string>          // mesmo conteúdo, p/ lookup O(1)
export const seisAccentMap: Record<string, string> // normalizado -> com acento
```

Invariante garantido: **toda solução também é um palpite válido** (`Solutions ⊆ Allowed`).

---

## 🔌 Integração no projeto `termooo`

Gerar o `.ts` é **só o dado**. Para o modo aparecer e funcionar no jogo, é preciso o "wiring" (foi o que se fez no **Modo 6**):

1. `src/game/types.ts` — incluir o modo em `GameMode`
2. `src/game/mode-config.ts` — entrada em `MODE_CONFIG` usando `<prefixo>Solutions/Allowed/AllowedSet` + `wordLength`
3. `src/game/engine.ts` — já é genérico no `wordLength` (não fixa mais "5")
4. UI — rota, aba (`TopTabs`), título; o tabuleiro renderiza `wordLength` colunas

Veja o item "Modo 6 Letras" no [ROADMAP_FEATURES.md](../termooo/ROADMAP_FEATURES.md) do `termooo` para o passo a passo completo.

---

## 📁 Arquivos do diretório

| Arquivo | O quê |
|---------|-------|
| `criar-modo-termo.js` | **Assistente interativo** (orquestra os 3 passos) — `pnpm start` |
| `extract-by-length.js` | Passo 1: extrai palavras de N letras do dicionário |
| `curate-solutions.js` | Passo 2: cura as soluções por frequência |
| `build-termo-words.js` | Passo 3: gera o módulo `.ts` |
| `br-utf8.txt` | Dicionário de entrada (IME-USP) — **fonte da verdade** |
| `freq_pt_br_50k.txt` | Lista de frequência (gerada/baixada) |
| `palavras-5.txt` / `palavras-6.txt` | Saídas do passo 1 (artefatos) |
| `solucoes-seis.txt` | Saída do passo 2 (artefato) |
| `package.json` / `pnpm-lock.yaml` | Deps do assistente (`prompts`, `picocolors`) |

Os `.txt` de saída são **artefatos regeneráveis** — pode apagar e gerar de novo a qualquer momento.

---

## 📝 Notas e limitações

- **Single player.** Os modos gerados aqui são de 1 tabuleiro e **não** entram no multiplayer (o servidor WebSocket só conhece os dicionários de 5 letras).
- **Sem dados de frequência embutidos.** A lista de frequência não vem no repositório (precisa baixar/gerar) — é um corpus externo, não parte do jogo.
- **Qualidade das soluções.** O corte por frequência aproxima muito bem a curadoria do original, mas pode deixar passar alguma palavra esquisita; a lista intermediária (`solucoes-*.txt`) é **editável à mão** antes de gerar o `.ts`.
