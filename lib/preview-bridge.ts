// Preview-only browser instrumentation. It never modifies repository files.
// The parent origin is provided by the trusted host, never inferred as '*'.
export function buildPreviewBridge(parentOrigin: string) {
  const origin = new URL(parentOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== parentOrigin) throw new Error('Invalid preview parent origin.');
  return String.raw`(() => {
    const expectedOrigin = ${JSON.stringify(parentOrigin)};
    const frameId = new URLSearchParams(location.search).get('__ah_frame');
    if (!frameId || parent === window) return;
    let initialized = false, restoring = false, timer = 0, mode = 'prototype';
    const finite = v => Number.isFinite(v) ? Math.max(0, v) : 0;
    const send = (type, data = {}) => parent.postMessage({ type: 'agent-harness:' + type, frameId, ...data }, expectedOrigin);
    const generation = crypto.randomUUID(), ids = new WeakMap();
    let nextId = 1, selected = null, lookup = new Map(), overlay = null, selectionTimer = 0, selectionMarker = null;
    const blocked = element => !!element.closest('script,style,noscript,template,input,textarea,select,[hidden],[aria-hidden="true"],[data-private],[data-ah-private],[data-ah-inspector]');
    const idFor = element => { if (!ids.has(element)) ids.set(element, 'n' + nextId++); return ids.get(element); };
    const elementText = element => {
      if (blocked(element)) return '';
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: node => node.nodeType === 1 && blocked(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      });
      let text = '', count = 0, node;
      while ((node = walker.nextNode()) && count++ < 500 && text.length < 2000) if (node.nodeType === 3) text += node.textContent || '';
      return text.slice(0, 2000);
    };
    const layer = (element, parentId, depth) => {
      // Labels use direct text only; do not duplicate a whole subtree per row.
      let direct = '', count = 0;
      for (const node of element.childNodes) { if (count++ >= 100 || direct.length >= 120) break; if (node.nodeType === 3) direct += (node.textContent || '').slice(0, 120) + ' '; }
      direct = direct.replace(/\s+/g, ' ').trim();
      return { id: idFor(element), parentId, depth, tag: element.localName.toLowerCase(), label: (element.getAttribute('aria-label') || direct || element.localName).slice(0, 120) };
    };
    const removeOverlay = () => { overlay?.remove(); overlay = null; };
    const highlight = () => {
      if (!selected?.isConnected || mode !== 'edit') { removeOverlay(); return; }
      if (!overlay) {
        overlay = document.createElement('div'); overlay.dataset.ahInspector = ''; overlay.setAttribute('aria-hidden', 'true');
        overlay.style.cssText = 'position:fixed;pointer-events:none!important;z-index:2147483647;outline:2px solid #315efb;border-radius:3px;box-sizing:border-box;';
        document.documentElement.appendChild(overlay);
      }
      const rect = selected.getBoundingClientRect();
      Object.assign(overlay.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    };
    const inspect = () => {
      if (!initialized || !document.body) return;
      const layers = []; lookup = new Map(); let visited = 0, truncated = false;
      const walk = (element, parentId, depth) => {
        if (visited++ >= 3000 || layers.length >= 200 || depth > 24) { truncated = true; return; }
        if (blocked(element)) return;
        const row = layer(element, parentId, depth); layers.push(row); lookup.set(row.id, element);
        for (const child of element.children) { if (layers.length >= 200 || visited >= 3000) { truncated = true; break; } walk(child, row.id, depth + 1); }
      };
      walk(document.body, null, 0);
      let selection = null;
      if (selected?.isConnected && !blocked(selected)) {
        const style = getComputedStyle(selected), rect = selected.getBoundingClientRect();
        const marker = selected.getAttribute('data-ah-source');
        selectionMarker = marker;
        selection = { ...layer(selected, null, 0), text: elementText(selected), width: rect.width, height: rect.height, source: marker && marker.length <= 8192 ? marker : null,
          styles: Object.fromEntries(['display','position','width','height','color','backgroundColor','fontFamily','fontSize','fontWeight','lineHeight','borderRadius','gap','padding','margin'].map(key => [key, String(style[key]).slice(0,2000)])) };
      } else { selected = null; clearInterval(selectionTimer); selectionTimer = 0; }
      highlight(); send('inspection', { inspection: { generation, capturedAt: new Date().toISOString(), layers, selection, truncated } });
    };
    const choose = element => {
      if (blocked(element)) return;
      selected = element; inspect();
      // No full-page MutationObserver or continuous DOM scan. Selection removal
      // and compiler-marker changes are cheap checks on one selected element.
      if (!selectionTimer) selectionTimer = setInterval(() => { if (selected && (!selected.isConnected || selected.getAttribute('data-ah-source') !== selectionMarker)) inspect(); }, 1000);
    };
    addEventListener('click', event => {
      if (!initialized || mode !== 'edit' || !(event.target instanceof Element)) return;
      // Scroll/wheel remain untouched. Only Edit-mode activation is intercepted.
      event.preventDefault(); event.stopImmediatePropagation(); choose(event.target);
    }, true);
    addEventListener('resize', highlight, { passive: true });
    addEventListener('scroll', highlight, { capture: true, passive: true });
    const keyFor = element => {
      for (const attribute of ['data-ah-scroll', 'data-testid', 'id']) {
        const value = element.getAttribute(attribute);
        if (!value || value.length > 240) continue;
        const selector = '[' + attribute + '=' + JSON.stringify(value) + ']';
        try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
      }
      return null;
    };
    const snapshot = () => ({
      windowX: finite(scrollX), windowY: finite(scrollY), capturedAt: new Date().toISOString(),
      containers: [...document.querySelectorAll('[data-ah-scroll],[data-testid],[id]')]
        .filter(el => el !== document.scrollingElement && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth))
        .flatMap(el => { const anchor = keyFor(el); return anchor ? [{ anchor, x: finite(el.scrollLeft), y: finite(el.scrollTop) }] : []; }).slice(0, 20)
    });
    const report = () => { timer = 0; if (initialized && !restoring) send('scroll', { snapshot: snapshot() }); };
    // Throttle, not debounce: long scrolls still save progress every 100 ms.
    addEventListener('scroll', () => { if (!timer && initialized && !restoring) timer = setTimeout(report, 100); }, { capture: true, passive: true });
    addEventListener('pagehide', report);
    addEventListener('message', async event => {
      if (event.source !== parent || event.origin !== expectedOrigin || event.data?.frameId !== frameId) return;
      if (event.data.type === 'agent-harness:mode' && ['edit','prototype','graph'].includes(event.data.mode)) { mode = event.data.mode; highlight(); return; }
      if (event.data.type === 'agent-harness:inspect') {
        if (event.data.nodeId) {
          if (event.data.generation !== generation) return;
          const element = lookup.get(event.data.nodeId); if (element?.isConnected) choose(element); else inspect();
        } else inspect();
        return;
      }
      if (event.data.type === 'agent-harness:flush-scroll') { clearTimeout(timer); report(); return; }
      if (event.data.type !== 'agent-harness:init' || initialized || restoring) return;
      restoring = true;
      if (['edit','prototype','graph'].includes(event.data.mode)) mode = event.data.mode;
      const scroll = event.data.scroll || {};
      if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      if (document.fonts) await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1500))]);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      for (const item of Array.isArray(scroll.containers) ? scroll.containers.slice(0, 20) : []) {
        // Only stable, bounded attribute selectors generated by this bridge.
        if (typeof item.anchor !== 'string' || item.anchor.length > 500 || !/^\[(?:id|data-testid|data-ah-scroll)=/.test(item.anchor)) continue;
        try { const nodes = document.querySelectorAll(item.anchor); if (nodes.length === 1) nodes[0].scrollTo(finite(item.x), finite(item.y)); } catch {}
      }
      scrollTo(finite(scroll.windowX), finite(scroll.windowY));
      initialized = true; restoring = false;
      send('ready'); report();
    });
    addEventListener('error', event => send('runtime-error', { message: String(event.message || 'Preview script failed').slice(0, 400) }));
    addEventListener('unhandledrejection', () => send('runtime-error', { message: 'An unhandled error occurred in the preview.' }));
    send('hello');
  })();`;
}
