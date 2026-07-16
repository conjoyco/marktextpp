<template>
  <div
    ref="splitSourceContainer"
    class="split-source"
  />
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { storeToRefs } from 'pinia'
import codeMirror, { setMode, setCursorAtFirstLine, setTextDirection } from '../../codeMirror'
import { wordCount as getWordCount } from 'muya/lib/utils'
import { adjustCursor } from '../../util'
import bus from '../../bus'
import { oneDarkThemes, railscastsThemes } from '@/config'

// The source pane of the side-by-side (split view) mode. Unlike sourceCode.vue,
// which replaces the WYSIWYG editor, this pane lives next to the live Muya
// editor and keeps both in sync while either one is edited.

const SYNC_DEBOUNCE = 300

const props = defineProps({
  markdown: {
    type: String,
    default: ''
  },
  textDirection: {
    type: String,
    required: true
  }
})

const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()

const splitSourceContainer = ref(null)

const { theme } = storeToRefs(preferencesStore)
const { currentFile } = storeToRefs(editorStore)

let cm = null
let commitTimer = null
let pendingTabId = null
// Which pane the pointer is over — scroll sync only follows the hovered pane
// so the two scroll handlers can never feed back into each other.
let hoveredPane = null

watch(
  () => props.textDirection,
  (value, oldValue) => {
    if (value !== oldValue && cm) {
      setTextDirection(cm, value)
    }
  }
)

const getMarkdownAndCursor = () => {
  let focus = cm.getCursor('head')
  let anchor = cm.getCursor('anchor')
  const markdown = cm.getValue()

  const convertToMuyaCursor = (cursor) => {
    const line = cm.getLine(cursor.line)
    const preLine = cm.getLine(cursor.line - 1)
    const nextLine = cm.getLine(cursor.line + 1)
    return adjustCursor(cursor, preLine, line, nextLine)
  }

  anchor = convertToMuyaCursor(anchor)
  focus = convertToMuyaCursor(focus)

  if (anchor && focus && anchor.line > focus.line) {
    const tmpCursor = focus
    focus = anchor
    anchor = tmpCursor
  }
  return { cursor: { focus, anchor }, markdown }
}

// Push the source pane's content into the tab state and the Muya editor.
const commitNow = () => {
  if (commitTimer) {
    clearTimeout(commitTimer)
    commitTimer = null
  }
  if (!cm || !pendingTabId) {
    return
  }
  const tabId = pendingTabId
  pendingTabId = null

  const { cursor, markdown } = getMarkdownAndCursor()
  const isCurrentTab = !!currentFile.value && currentFile.value.id === tabId
  // Captured before LISTEN_FOR_CONTENT_CHANGE overwrites it.
  const storeMarkdown = isCurrentTab ? currentFile.value.markdown : null

  editorStore.LISTEN_FOR_CONTENT_CHANGE({
    id: tabId,
    markdown,
    wordCount: getWordCount(markdown),
    muyaIndexCursor: cursor
  })

  // Only update the live preview when the edited tab is still the current one
  // and the content actually changed — setMarkdown re-renders unconditionally.
  if (isCurrentTab && markdown !== storeMarkdown) {
    bus.emit('split-source-change', { markdown, muyaIndexCursor: cursor })
  }
}

const handleCmChanges = (instance, changes) => {
  // Programmatic updates (tab switch, Muya echo) must not be pushed back.
  if (changes.every((change) => change.origin === 'setValue')) {
    return
  }
  pendingTabId = currentFile.value ? currentFile.value.id : null
  if (commitTimer) clearTimeout(commitTimer)
  commitTimer = setTimeout(commitNow, SYNC_DEBOUNCE)
}

// Muya (or a tab switch) updated the document — mirror it into the pane.
let lastTabId = null
let mirrorTimer = null

const mirrorFromStore = (isTabSwitch) => {
  if (!cm || !currentFile.value || typeof currentFile.value.markdown !== 'string') {
    return
  }
  if (isTabSwitch) {
    // Flush edits belonging to the previous tab before loading the new one —
    // commitNow routes them by the tab id captured when the edit happened.
    commitNow()
  } else if (pendingTabId) {
    // Uncommitted edits in this pane make it authoritative for the current
    // tab; mirroring the (older) store value now would drop those keystrokes.
    return
  }
  const value = currentFile.value.markdown
  if (value !== cm.getValue()) {
    cm.setValue(value)
    // Keep cursor and scroll position on live sync; reset only for a new tab.
    if (isTabSwitch) {
      setCursorAtFirstLine(cm)
    }
  }
}

watch(
  () => currentFile.value && currentFile.value.markdown,
  (value) => {
    if (!cm || typeof value !== 'string') {
      return
    }
    const tabId = currentFile.value ? currentFile.value.id : null
    const isTabSwitch = tabId !== lastTabId
    lastTabId = tabId
    // While the pane has focus every store update is an echo of our own edits
    // (possibly normalized by Muya) — overwriting mid-typing would fight the user.
    if (cm.hasFocus()) {
      return
    }
    if (mirrorTimer) clearTimeout(mirrorTimer)
    if (isTabSwitch) {
      mirrorFromStore(true)
    } else {
      // Coalesce rapid Muya keystrokes — a full CodeMirror setValue per key is wasteful.
      mirrorTimer = setTimeout(() => mirrorFromStore(false), 200)
    }
  }
)

const handleSelectAll = () => {
  if (cm && cm.hasFocus()) {
    cm.execCommand('selectAll')
  }
}

const muyaScrollContainer = () => document.querySelector('.editor-component')
let observedMuyaContainer = null

const syncScrollFrom = (source, target) => {
  const sourceMax = source.scrollHeight - source.clientHeight
  const targetMax = target.scrollHeight - target.clientHeight
  if (sourceMax <= 0 || targetMax <= 0) {
    return
  }
  target.scrollTop = (source.scrollTop / sourceMax) * targetMax
}

const handleSourceScroll = () => {
  const muyaContainer = muyaScrollContainer()
  if (hoveredPane === 'source' && muyaContainer) {
    syncScrollFrom(splitSourceContainer.value, muyaContainer)
  }
}

const handlePreviewScroll = () => {
  const muyaContainer = muyaScrollContainer()
  if (hoveredPane === 'preview' && muyaContainer) {
    syncScrollFrom(muyaContainer, splitSourceContainer.value)
  }
}

const handleSourceEnter = () => {
  hoveredPane = 'source'
}

const handlePreviewEnter = () => {
  hoveredPane = 'preview'
}

onMounted(() => {
  const container = splitSourceContainer.value
  const codeMirrorConfig = {
    value: props.markdown,
    lineNumbers: true,
    autofocus: false,
    lineWrapping: true,
    styleActiveLine: true,
    direction: props.textDirection,
    viewportMargin: Infinity,
    lineNumberFormatter(line) {
      if (line % 10 === 0 || line === 1) {
        return line
      } else {
        return ''
      }
    }
  }

  if (railscastsThemes.includes(theme.value)) {
    codeMirrorConfig.theme = 'railscasts'
  } else if (oneDarkThemes.includes(theme.value)) {
    codeMirrorConfig.theme = 'one-dark'
  }

  cm = codeMirror(container, codeMirrorConfig)
  setMode(cm, 'markdown')
  setCursorAtFirstLine(cm)
  lastTabId = currentFile.value ? currentFile.value.id : null

  cm.on('contextmenu', (instance, event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  cm.on('changes', handleCmChanges)
  // Commit as soon as focus leaves the pane so an edit in the WYSIWYG pane
  // can never race against a stale pending commit from this one.
  cm.on('blur', commitNow)

  bus.on('selectAll', handleSelectAll)

  container.addEventListener('mouseenter', handleSourceEnter)
  container.addEventListener('scroll', handleSourceScroll)
  // The Muya editor may mount after this pane in the same patch — defer until
  // the whole tree is in the DOM.
  nextTick(() => {
    observedMuyaContainer = muyaScrollContainer()
    if (observedMuyaContainer) {
      observedMuyaContainer.addEventListener('mouseenter', handlePreviewEnter)
      observedMuyaContainer.addEventListener('scroll', handlePreviewScroll)
    }
  })
})

onBeforeUnmount(() => {
  if (mirrorTimer) clearTimeout(mirrorTimer)
  commitNow()

  bus.off('selectAll', handleSelectAll)

  const container = splitSourceContainer.value
  container.removeEventListener('mouseenter', handleSourceEnter)
  container.removeEventListener('scroll', handleSourceScroll)
  if (observedMuyaContainer) {
    observedMuyaContainer.removeEventListener('mouseenter', handlePreviewEnter)
    observedMuyaContainer.removeEventListener('scroll', handlePreviewScroll)
    observedMuyaContainer = null
  }
  cm = null
})
</script>

<style>
.split-source {
  height: 100%;
  flex-shrink: 0;
  box-sizing: border-box;
  overflow: auto;
}
.split-source .CodeMirror {
  height: auto;
  margin: 30px 15px;
  background: transparent;
}
.split-source .CodeMirror-gutters {
  border-right: none;
  background-color: transparent;
}
.split-source .CodeMirror-activeline-background,
.split-source .CodeMirror-activeline-gutter {
  background: var(--floatHoverColor);
}
</style>
