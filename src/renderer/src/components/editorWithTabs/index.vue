<template>
  <div
    class="editor-with-tabs"
    :style="{ 'max-width': showSideBar ? `calc(100vw - ${sideBarWidth}px` : '100vw' }"
  >
    <tabs v-show="showTabBar" />
    <div ref="container" class="container" :class="{ 'split-view': splitView }">
      <split-source
        v-if="splitView"
        :markdown="markdown"
        :text-direction="textDirection"
        :style="{ width: `${splitRatio * 100}%` }"
      />
      <div v-if="splitView" class="split-drag-bar" @mousedown.prevent="handleSplitDragStart" />
      <editor
        :markdown="markdown"
        :cursor="cursor"
        :text-direction="textDirection"
        :platform="platform"
      />
      <source-code
        v-if="sourceCode"
        :markdown="markdown"
        :muya-index-cursor="muyaIndexCursor"
        :text-direction="textDirection"
      />
    </div>
    <tab-notifications />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useLayoutStore } from '@/store/layout'
import { usePreferencesStore } from '@/store/preferences'
import { storeToRefs } from 'pinia'
import Tabs from './tabs.vue'
import Editor from './editor.vue'
import SourceCode from './sourceCode.vue'
import SplitSource from './splitSource.vue'
import TabNotifications from './notifications.vue'

const SPLIT_RATIO_STORAGE_KEY = 'marktext-split-view-ratio'
const MIN_SPLIT_RATIO = 0.2
const MAX_SPLIT_RATIO = 0.8

defineProps({
  markdown: {
    type: String,
    required: true
  },
  cursor: {
    validator(value) {
      return typeof value === 'object'
    },
    required: true
  },
  muyaIndexCursor: {
    type: Object,
    default: null
  },
  sourceCode: {
    type: Boolean,
    required: true
  },
  showTabBar: {
    type: Boolean,
    required: true
  },
  textDirection: {
    type: String,
    required: true
  },
  platform: {
    type: String,
    required: true
  }
})

const layoutStore = useLayoutStore()
const preferencesStore = usePreferencesStore()

const { showSideBar, sideBarWidth } = storeToRefs(layoutStore)
const { splitView } = storeToRefs(preferencesStore)

const container = ref(null)

const loadSplitRatio = () => {
  const saved = Number.parseFloat(localStorage.getItem(SPLIT_RATIO_STORAGE_KEY))
  if (Number.isFinite(saved) && saved >= MIN_SPLIT_RATIO && saved <= MAX_SPLIT_RATIO) {
    return saved
  }
  return 0.5
}

const splitRatio = ref(loadSplitRatio())

const handleSplitDragStart = () => {
  const containerEl = container.value
  if (!containerEl) return

  const mouseMoveHandler = (event) => {
    const { left, width } = containerEl.getBoundingClientRect()
    if (width <= 0) return
    const ratio = (event.clientX - left) / width
    splitRatio.value = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio))
  }

  const mouseUpHandler = () => {
    document.removeEventListener('mousemove', mouseMoveHandler, false)
    document.removeEventListener('mouseup', mouseUpHandler, false)
    localStorage.setItem(SPLIT_RATIO_STORAGE_KEY, String(splitRatio.value))
  }

  document.addEventListener('mousemove', mouseMoveHandler, false)
  document.addEventListener('mouseup', mouseUpHandler, false)
}
</script>

<style scoped>
.editor-with-tabs {
  position: relative;
  height: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;

  overflow: hidden;
  background: var(--editorBgColor);
  & > .container {
    flex: 1;
    overflow: hidden;
  }
  & > .container.split-view {
    display: flex;
    flex-direction: row;
    & .editor-wrapper {
      min-width: 0;
    }
  }
}

.split-drag-bar {
  flex-shrink: 0;
  width: 3px;
  height: 100%;
  cursor: col-resize;
  background: var(--floatBorderColor);
  &:hover {
    background: var(--themeColor);
  }
}
</style>
