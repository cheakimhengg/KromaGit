import hljs from 'highlight.js/lib/core'
import typescript from 'highlight.js/lib/languages/typescript'
import javascript from 'highlight.js/lib/languages/javascript'
import rust from 'highlight.js/lib/languages/rust'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import json from 'highlight.js/lib/languages/json'
import csharp from 'highlight.js/lib/languages/csharp'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import bash from 'highlight.js/lib/languages/bash'
import scss from 'highlight.js/lib/languages/scss'
import less from 'highlight.js/lib/languages/less'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import kotlin from 'highlight.js/lib/languages/kotlin'
import swift from 'highlight.js/lib/languages/swift'
import php from 'highlight.js/lib/languages/php'
import ruby from 'highlight.js/lib/languages/ruby'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import ini from 'highlight.js/lib/languages/ini'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import graphql from 'highlight.js/lib/languages/graphql'

const langs = { typescript, javascript, rust, xml, css, json, csharp, python, sql, yaml, markdown, bash, scss, less, go, java, kotlin, swift, php, ruby, cpp, c, ini, dockerfile, graphql }
for (const [name, def] of Object.entries(langs)) hljs.registerLanguage(name, def)

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Highlights a single line. Returns escaped HTML safe for v-html. */
export function highlightLine(text: string, language: string): string {
  if (!hljs.getLanguage(language)) return escapeHtml(text)
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(text)
  }
}

/** Files that mix markup with <script> and <style> blocks (Vue, Svelte, HTML). */
export const isMixedMarkup = (path: string) => /\.(vue|svelte|html?)$/i.test(path)

const STYLE_OPEN = /<style\b([^>]*)>/i
const SCRIPT_OPEN = /<script\b([^>]*)>/i
const styleLang = (attrs: string) => (/lang=["']?(scss|sass)/i.test(attrs) ? 'scss' : /lang=["']?less/i.test(attrs) ? 'less' : 'css')
const scriptLang = (attrs: string) => (/lang=["']?(ts|tsx)/i.test(attrs) ? 'typescript' : 'javascript')

/** Best guess for where a hunk starts when its opening tag is outside the diff. */
function guessSection(lines: string[]): string {
  for (const t of lines) {
    if (/<\/style>/i.test(t)) return 'css'
    if (/<\/script>/i.test(t)) return 'typescript'
    if (STYLE_OPEN.test(t) || SCRIPT_OPEN.test(t) || /<\/?template\b/i.test(t)) return 'xml'
  }
  let css = 0
  let code = 0
  let markup = 0
  for (const t of lines) {
    if (/^\s*[-\w.#&:>*\[\]@ ,()]+\{\s*$/.test(t) || /^\s*-{0,2}[\w-]+\s*:\s*[^;{}]+;\s*$/.test(t)) css++
    if (/\b(const|let|import|export|return|function|await|async)\b|=>/.test(t)) code++
    if (/^\s*<\/?[\w-]+[\s>]/.test(t)) markup++
  }
  if (css >= code && css >= markup && css > 0) return 'css'
  if (code > markup) return 'typescript'
  return 'xml'
}

/** The language for every line of each hunk in a mixed file, following <script> / <style> blocks. */
export function mixedLanguages(hunks: { lines: { text: string }[] }[]): string[][] {
  return hunks.map((h) => {
    const texts = h.lines.map((l) => l.text)
    let lang = guessSection(texts)
    return texts.map((t) => {
      const so = t.match(STYLE_OPEN)
      if (so && !/<\/style>/i.test(t)) { lang = styleLang(so[1]); return 'xml' }
      const sc = t.match(SCRIPT_OPEN)
      if (sc && !/<\/script>/i.test(t)) { lang = scriptLang(sc[1]); return 'xml' }
      if (/<\/(style|script)>/i.test(t)) { lang = 'xml'; return 'xml' }
      return lang
    })
  })
}
