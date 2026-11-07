/**
 * Message metrics — Web page.
 *
 * Adds a gauge action to the assistant message action strip. Opening it shows
 * the performance dashboard for that reply, computed from the durable message
 * the Session already holds:
 *
 *   - provider/model route
 *   - prompt tokens, cached tokens, cache-hit share
 *   - output tokens (with reasoning)
 *   - time to first token
 *   - prefill throughput (computed prompt tokens / TTFT)
 *   - decode throughput (output tokens / decode time)
 *   - total request time
 *
 * The surface follows the shipped stat dialogs: a 28px IconActions trigger,
 * the menu surface with `--dsw-elevation-prominent`, the 12px detail grid,
 * and the same viewport-clamped placement above the trigger.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-message-metrics',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const { IconGaugeOutlineRegular, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    const NS = 'message-metrics'
    const PANEL_MARGIN = 12
    const PANEL_GAP = 8

    const zh = {
      action: '性能指标',
      title: '本条回复 · 性能指标',
      model: '模型',
      prompt: '提示词',
      cached: '缓存命中',
      uncached: '未缓存',
      cacheWrite: '缓存写入',
      output: '输出',
      reasoning: '（推理 {tokens}）',
      ttft: '首 token',
      prefill: '预填充',
      uncachedRate: '未缓存计算速率',
      decode: '解码',
      total: '总耗时',
      empty: '暂无数据',
      unit: 'tok/s',
    }

    const en = {
      action: 'Performance',
      title: 'This reply · Performance',
      model: 'Model',
      prompt: 'Prompt',
      cached: 'Cached',
      uncached: 'Uncached',
      cacheWrite: 'Cache write',
      output: 'Output',
      reasoning: ' ({tokens} reasoning)',
      ttft: 'First token',
      prefill: 'Prefill',
      uncachedRate: 'Uncached compute',
      decode: 'Decode',
      total: 'Total',
      empty: 'No data',
      unit: 'tok/s',
    }

    // One injected sheet, scoped by the dmm- prefix. Every colour, radius and
    // elevation rides the theme tokens the shipped stat dialogs use.
    const CSS = `
.dmm-root { display: inline-flex; align-items: center; }
.dmm-trigger {
  display: inline-flex; align-items: center; justify-content: center;
  width: calc(28px + var(--dsh-content-font-delta, 0px));
  height: calc(28px + var(--dsh-content-font-delta, 0px));
  padding: 6px; border: none; border-radius: var(--dsw-radius-sm);
  background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer;
}
.dmm-trigger svg {
  width: calc(17px + var(--dsh-content-font-delta, 0px));
  height: calc(17px + var(--dsh-content-font-delta, 0px));
}
.dmm-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.dmm-trigger[aria-expanded='true'] { color: var(--dsw-alias-label-secondary); }
.dmm-panel {
  position: fixed; z-index: 1100; box-sizing: border-box;
  width: max-content;
  min-width: min(288px, calc(100vw - 24px));
  max-width: min(440px, calc(100vw - 24px));
  padding: 16px; border: 0; border-radius: var(--dsw-radius-lg);
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-secondary); cursor: default;
}
.dmm-title {
  display: flex; justify-content: space-between; gap: 16px;
  margin-bottom: 8px; color: var(--dsw-alias-label-primary); font-weight: 500;
}
.dmm-title-label { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.dmm-title-label svg { width: 14px; height: 14px; flex: none; }
.dmm-title-value { font-variant-numeric: tabular-nums; white-space: nowrap; }
.dmm-rule { margin-bottom: 10px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dmm-details {
  display: grid; grid-template-columns: minmax(76px, auto) minmax(0, 1fr);
  gap: 6px 16px; margin: 0; color: var(--dsw-alias-label-tertiary);
}
.dmm-details dt, .dmm-details dd { min-width: 0; margin: 0; }
.dmm-details dd { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; text-align: right; }
.dmm-details dd.dmm-route { overflow-wrap: anywhere; }
.dmm-note { color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
`

    /** Read the disjoint token buckets the LLM layer records for one call. */
    function readUsage(node) {
      const usage = node !== null && typeof node.usage === 'object' && node.usage !== null ? node.usage : {}
      const pick = (...values) => {
        for (const value of values) {
          if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
        }
        return 0
      }
      // `inputTokens` is uncached input only; cache read/write are disjoint.
      const input = pick(usage.uncachedInputTokens, usage.inputTokens, usage.input)
      const cached = pick(usage.cacheReadTokens, usage.cacheRead)
      const cacheWrite = pick(usage.cacheWriteTokens, usage.cacheWrite)
      const output = pick(usage.outputTokens, usage.output)
      const reasoning = pick(usage.reasoningTokens, usage.reasoning)
      return { input, cached, cacheWrite, output, reasoning }
    }

    /** Derive the timing facts from the assistant node's recorded boundaries. */
    function readTiming(node) {
      const timing = node !== null && typeof node.timing === 'object' && node.timing !== null ? node.timing : null
      const stepStart = timing !== null && typeof timing.stepStartTime === 'number' ? timing.stepStartTime : null
      const firstToken = timing !== null && typeof timing.firstTokenTime === 'number' ? timing.firstTokenTime : null
      const completed = timing !== null && typeof timing.completedTime === 'number' ? timing.completedTime : null
      const ttftMs = stepStart !== null && firstToken !== null ? Math.max(0, firstToken - stepStart) : null
      const decodeMs = firstToken !== null && completed !== null ? Math.max(0, completed - firstToken) : null
      const totalMs = stepStart !== null && completed !== null ? Math.max(0, completed - stepStart) : null
      return { ttftMs, decodeMs, totalMs }
    }

    function readMetrics(node) {
      const usage = readUsage(node)
      const timing = readTiming(node)
      const promptTokens = usage.input + usage.cached + usage.cacheWrite
      // Prompt ingestion rate: every prompt token the request had to take in,
      // cached or computed, over the time to the first token.
      const prefillTps = timing.ttftMs !== null && timing.ttftMs > 0 && promptTokens > 0
        ? promptTokens / (timing.ttftMs / 1000)
        : null
      // The model's own share of the prompt: cache misses plus cache writes.
      const computedTokens = usage.input + usage.cacheWrite
      const uncachedTps = timing.ttftMs !== null && timing.ttftMs > 0 && computedTokens > 0
        ? computedTokens / (timing.ttftMs / 1000)
        : null
      const decodeTps = timing.decodeMs !== null && timing.decodeMs > 0 && usage.output > 0
        ? usage.output / (timing.decodeMs / 1000)
        : null
      const cachePercent = formatPercent(usage.cached, promptTokens)
      const config = node !== null && typeof node.requestConfig === 'object' && node.requestConfig !== null ? node.requestConfig : null
      const metadata = node !== null && typeof node.providerMetadata === 'object' && node.providerMetadata !== null ? node.providerMetadata : null
      const provider = (config !== null && config.provider) || (metadata !== null && metadata.provider) || null
      const model = (config !== null && config.model) || (metadata !== null && metadata.model) || null
      return {
        promptTokens,
        inputTokens: usage.input,
        cachedTokens: usage.cached,
        cacheWriteTokens: usage.cacheWrite,
        outputTokens: usage.output,
        reasoningTokens: usage.reasoning,
        cachePercent,
        prefillTps,
        uncachedTps,
        decodeTps,
        ttftMs: timing.ttftMs,
        decodeMs: timing.decodeMs,
        totalMs: timing.totalMs,
        provider,
        model,
      }
    }

    const numberFormat = (() => {
      try {
        return new Intl.NumberFormat(document.documentElement.lang || undefined)
      } catch {
        return new Intl.NumberFormat()
      }
    })()

    function formatCount(value) {
      return numberFormat.format(Math.round(value))
    }

    function formatDuration(ms) {
      if (ms === null) return '—'
      return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
    }

    function formatRate(value) {
      if (value === null) return '—'
      return value >= 1000 ? numberFormat.format(Math.round(value)) : value.toFixed(1)
    }

    /**
     * Cache-hit share of the prompt. Integer text while rounding stays below
     * 100; otherwise the smallest precision that still reads below 100, so a
     * 99.99% hit never displays as a full 100%.
     */
    function formatPercent(cached, total) {
      if (!(total > 0) || !(cached > 0)) return null
      const percent = (cached / total) * 100
      if (percent >= 100) return '100'
      for (let digits = 0; digits <= 2; digits += 1) {
        const rounded = Number(percent.toFixed(digits))
        if (rounded < 100) return rounded.toFixed(digits)
      }
      return percent.toFixed(2)
    }

    /**
     * Find one assistant message in either conversation target.
     *
     * The Trajectory target keeps the durable timing (it folds the packed
     * stream records back into the first-token timestamp) and the message
     * source's provider/model; the Chat target only has live-stream timing and
     * no route. Read both and merge so an assembly without Trajectory still
     * shows the token buckets.
     */
    function findAssistant(snapshot, messageId) {
      const nodes = snapshot !== null && typeof snapshot === 'object'
        ? Array.isArray(snapshot.eventNodes) ? snapshot.eventNodes : snapshot.legacy?.nodes
        : undefined
      if (!Array.isArray(nodes)) return null
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const candidate = nodes[index]
        if (candidate !== undefined && candidate.kind === 'assistant' && candidate.messageId === messageId) return candidate
      }
      return null
    }

    /** Stable no-op for assemblies that do not provide the Trajectory hook. */
    function useNoTrajectory() {
      return null
    }

    /**
     * Merge the two views of one message: Chat owns the settled row, while
     * Trajectory owns the durable first-token time and the provider/model
     * route. Each field takes the first view that actually recorded it.
     */
    function mergeMessage(chatNode, trajectoryNode) {
      const base = chatNode ?? trajectoryNode
      if (base === null || base === undefined) return null
      const chatTiming = chatNode !== null && typeof chatNode === 'object' ? chatNode.timing : undefined
      const trajectoryTiming = trajectoryNode !== null && typeof trajectoryNode === 'object' ? trajectoryNode.timing : undefined
      const timing = {
        stepStartTime: trajectoryTiming?.stepStartTime ?? chatTiming?.stepStartTime ?? null,
        firstTokenTime: trajectoryTiming?.firstTokenTime ?? chatTiming?.firstTokenTime ?? null,
        completedTime: trajectoryTiming?.completedTime ?? chatTiming?.completedTime ?? null,
      }
      const trajectoryUsage = trajectoryNode !== null && typeof trajectoryNode === 'object' ? trajectoryNode.usage : undefined
      const chatMetadata = chatNode !== null && typeof chatNode === 'object' ? chatNode.providerMetadata : undefined
      const trajectoryMetadata = trajectoryNode !== null && typeof trajectoryNode === 'object' ? trajectoryNode.providerMetadata : undefined
      return {
        ...base,
        usage: trajectoryUsage ?? base.usage,
        timing,
        providerMetadata: trajectoryMetadata ?? chatMetadata ?? null,
      }
    }

    function MessageMetricsAction({ messageId, useChat, useTrajectory, t }) {
      // Hook order is stable: the composition either provides the Trajectory
      // standard hook or it does not, and that never changes for one entry.
      const useTrajectorySafe = typeof useTrajectory === 'function' ? useTrajectory : useNoTrajectory
      const chatNode = useChat((snapshot) => findAssistant(snapshot, messageId))
      const trajectoryNode = useTrajectorySafe((snapshot) => findAssistant(snapshot, messageId))
      const node = mergeMessage(chatNode, trajectoryNode)
      const [open, setOpen] = React.useState(false)
      const [position, setPosition] = React.useState(null)
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)

      // Measure the real panel, then clamp it above the trigger. The hidden
      // first pass keeps the clamp from depending on a guessed size.
      React.useLayoutEffect(() => {
        if (!open) {
          setPosition(null)
          return
        }
        const anchor = rootRef.current
        const panel = panelRef.current
        if (anchor === null || panel === null) return
        const rect = anchor.getBoundingClientRect()
        const width = panel.offsetWidth
        const height = panel.offsetHeight
        const left = Math.min(
          Math.max(PANEL_MARGIN, rect.left),
          Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN),
        )
        let top = rect.top - PANEL_GAP - height
        if (top < PANEL_MARGIN) {
          top = Math.min(rect.bottom + PANEL_GAP, window.innerHeight - height - PANEL_MARGIN)
        }
        setPosition({ left, top })
      }, [open])

      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          const target = event.target
          if (!(target instanceof Node)) return
          if (rootRef.current?.contains(target) === true) return
          if (panelRef.current?.contains(target) === true) return
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      if (node === null || node === undefined) return null

      const metrics = readMetrics(node)
      const label = t('action')
      const route = metrics.model === null
        ? null
        : metrics.provider === null ? metrics.model : `${metrics.provider} / ${metrics.model}`
      const rows = []
      if (route !== null) rows.push(['model', route, 'dmm-route'])
      rows.push(['prompt', formatCount(metrics.promptTokens)])
      if (metrics.cachedTokens > 0) {
        const share = metrics.cachePercent === null ? '' : ` (${metrics.cachePercent}%)`
        rows.push(['cached', `${formatCount(metrics.cachedTokens)}${share}`])
      }
      if (metrics.inputTokens > 0) rows.push(['uncached', formatCount(metrics.inputTokens)])
      if (metrics.cacheWriteTokens > 0) rows.push(['cacheWrite', formatCount(metrics.cacheWriteTokens)])
      rows.push([
        'output',
        metrics.reasoningTokens > 0
          ? `${formatCount(metrics.outputTokens)}${t('reasoning', { tokens: formatCount(metrics.reasoningTokens) })}`
          : formatCount(metrics.outputTokens),
      ])
      rows.push(['ttft', formatDuration(metrics.ttftMs)])
      rows.push(['prefill', metrics.prefillTps === null ? '—' : `${formatRate(metrics.prefillTps)} ${t('unit')}`])
      if (metrics.uncachedTps !== null) {
        rows.push(['uncachedRate', `${formatRate(metrics.uncachedTps)} ${t('unit')}`])
      }
      rows.push(['decode', metrics.decodeTps === null ? '—' : `${formatRate(metrics.decodeTps)} ${t('unit')}`])
      rows.push(['total', formatDuration(metrics.totalMs)])

      return h(
        React.Fragment,
        null,
        h(
          'span',
          { ref: rootRef, className: 'dmm-root', 'data-message-metrics': messageId },
          h(
            Tooltip,
            { label, side: 'bottom' },
            h(
              'button',
              {
                type: 'button',
                className: 'dmm-trigger',
                'aria-label': label,
                'aria-haspopup': 'dialog',
                'aria-expanded': open ? 'true' : 'false',
                onClick: () => { setOpen((value) => !value) },
              },
              h(IconGaugeOutlineRegular, null),
            ),
          ),
        ),
        open && createPortal(
          h(
            'div',
            {
              ref: panelRef,
              className: 'dmm-panel',
              role: 'dialog',
              'aria-label': t('title'),
              style: position === null
                ? { visibility: 'hidden', left: 0, top: 0 }
                : { left: position.left, top: position.top },
            },
            h(
              'div',
              { className: 'dmm-title' },
              h('span', { className: 'dmm-title-label' }, h(IconGaugeOutlineRegular, { size: 14 }), t('title')),
              h('span', { className: 'dmm-title-value' }, metrics.decodeTps === null ? '—' : `${formatRate(metrics.decodeTps)} ${t('unit')}`),
            ),
            h('div', { className: 'dmm-rule', 'aria-hidden': 'true' }),
            h(
              'dl',
              { className: 'dmm-details' },
              ...rows.map(([key, value, extra]) => h(
                React.Fragment,
                { key },
                h('dt', null, t(key)),
                h('dd', { className: extra }, value),
              )),
            ),
          ),
          document.body,
        ),
      )
    }

    return {
      name: 'dsh-message-metrics',
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'message-metrics: zh dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'message-metrics: en dictionary')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshMessageMetrics = ''
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'message-metrics: styles')
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'message-metrics',
          order: 20,
          locale: NS,
        }, MessageMetricsAction))
      },
    }
  },
})
