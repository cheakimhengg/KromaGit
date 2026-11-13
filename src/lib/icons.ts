/**
 * The app's icon set: Hugeicons (stroke rounded, MIT), generated subset in
 * icons.generated.ts — run `node scripts/gen-icons.mjs` after adding a name
 * there. Every component imports icons from here, so the look changes in one place.
 */
import { defineComponent, h } from 'vue'
import { ICONS } from './icons.generated'

let uid = 0

/** Some icon bodies use ids (masks/clip paths); give every rendered copy its own so a hidden copy never breaks a visible one. */
function uniqueIds(body: string): string {
  if (!body.includes('id="')) return body
  const n = (++uid).toString(36)
  return body.replace(/id="([^"]+)"/g, `id="$1-${n}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-${n})`)
}

function icon(name: string) {
  const data = ICONS[name]
  if (!data) throw new Error(`icon ${name} missing — add it to scripts/gen-icons.mjs`)
  return defineComponent({
    name,
    inheritAttrs: false,
    props: {
      size: { type: [Number, String], default: 16 },
      /** accepted for compatibility; heavier strokes for emphasis */
      strokeWidth: { type: [Number, String], default: undefined },
    },
    setup(props, { attrs }) {
      const html = uniqueIds(data.body)
      return () => {
        const sw = Number(props.strokeWidth)
        const body = sw >= 2 ? html.replace(/stroke-width="1\.5"/g, 'stroke-width="2"') : html
        return h('svg', {
          ...attrs,
          xmlns: 'http://www.w3.org/2000/svg',
          width: props.size,
          height: props.size,
          viewBox: `0 0 ${data.w} ${data.h}`,
          'aria-hidden': 'true',
          innerHTML: body,
        })
      }
    },
  })
}

export const AlertOctagon = icon('AlertOctagon')
export const AlertTriangle = icon('AlertTriangle')
export const TriangleAlert = AlertTriangle
export const AppWindow = icon('AppWindow')
export const Archive = icon('Archive')
export const ArchiveRestore = icon('ArchiveRestore')
export const ArrowDown = icon('ArrowDown')
export const ArrowUp = icon('ArrowUp')
export const ArrowDownToLine = icon('ArrowDownToLine')
export const ArrowUpFromLine = icon('ArrowUpFromLine')
export const Boxes = icon('Boxes')
export const Brush = icon('Brush')
export const Bug = icon('Bug')
export const CalendarClock = icon('CalendarClock')
export const Check = icon('Check')
export const CheckCircle2 = icon('CheckCircle2')
export const Cherry = icon('Cherry')
export const ChevronDown = icon('ChevronDown')
export const ChevronRight = icon('ChevronRight')
export const ChevronsDownUp = icon('ChevronsDownUp')
export const ChevronsUpDown = icon('ChevronsUpDown')
export const CircleDot = icon('CircleDot')
export const Clock = icon('Clock')
export const Cloud = icon('Cloud')
export const CloudCheck = icon('CloudCheck')
export const CloudDownload = icon('CloudDownload')
export const CloudOff = icon('CloudOff')
export const Code2 = icon('Code2')
export const Columns2 = icon('Columns2')
export const Columns3 = icon('Columns3')
export const SlidersHorizontal = icon('SlidersHorizontal')
export const Command = icon('Command')
export const Copy = icon('Copy')
export const CornerDownLeft = icon('CornerDownLeft')
export const FileCode2 = icon('FileCode2')
export const FileDiff = icon('FileDiff')
export const Folder = icon('Folder')
export const FolderGit2 = icon('FolderGit2')
export const FolderOpen = icon('FolderOpen')
export const FolderSearch = icon('FolderSearch')
export const FolderTree = icon('FolderTree')
export const GitBranch = icon('GitBranch')
export const GitBranchPlus = icon('GitBranchPlus')
export const GitCommitHorizontal = icon('GitCommitHorizontal')
export const GitMerge = icon('GitMerge')
export const GitPullRequestArrow = icon('GitPullRequestArrow')
export const Globe = icon('Globe')
export const House = icon('House')
export const ImageOff = icon('ImageOff')
export const Info = icon('Info')
export const KeyRound = icon('KeyRound')
export const Keyboard = icon('Keyboard')
export const Layers = icon('Layers')
export const LayoutList = icon('LayoutList')
export const Lightbulb = icon('Lightbulb')
export const List = icon('List')
export const Loader2 = icon('Loader2')
export const Minus = icon('Minus')
export const Monitor = icon('Monitor')
export const Moon = icon('Moon')
export const Palette = icon('Palette')
export const PanelLeft = icon('PanelLeft')
export const Pencil = icon('Pencil')
export const Play = icon('Play')
export const Plus = icon('Plus')
export const Redo2 = icon('Redo2')
export const RefreshCw = icon('RefreshCw')
export const RotateCcw = icon('RotateCcw')
export const RotateCw = icon('RotateCw')
export const Rows3 = icon('Rows3')
export const ScanSearch = icon('ScanSearch')
export const Search = icon('Search')
export const Settings = icon('Settings')
export const ShieldCheck = icon('ShieldCheck')
export const Sparkles = icon('Sparkles')
export const Split = icon('Split')
export const Sun = icon('Sun')
export const Tag = icon('Tag')
export const Terminal = icon('Terminal')
export const Trash2 = icon('Trash2')
export const Undo = icon('Undo')
export const Undo2 = icon('Undo2')
export const Ungroup = icon('Ungroup')
export const User = icon('User')
export const X = icon('X')
export const XCircle = icon('XCircle')
export const ZoomIn = icon('ZoomIn')
export const ZoomOut = icon('ZoomOut')
export const TextWrap = icon('TextWrap')
export const Space = icon('Space')
export const TextFont = icon('TextFont')
export const FileView = icon('FileView')
export const Files = icon('Files')
