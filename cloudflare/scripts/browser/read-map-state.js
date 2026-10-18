(() => {
  const dlgs = document.querySelectorAll('[role=dialog]');
  const dlg = dlgs[dlgs.length - 1];
  const mapEl = dlg ? dlg.querySelector('.leaflet-container') : null;
  let map = null;
  if (mapEl) {
    for (const k of Object.keys(mapEl)) {
      if (k.indexOf('_leaflet_') === 0) map = mapEl[k];
    }
  }
  const center = map
    ? { lat: Math.round(map.getCenter().lat * 1e6) / 1e6, lng: Math.round(map.getCenter().lng * 1e6) / 1e6 }
    : null;
  const zoom = map ? map.getZoom() : null;
  let footer = null;
  if (dlg) {
    const t = dlg.textContent || '';
    const i = t.indexOf('VỊ TRÍ ĐÃ CHỌN');
    if (i >= 0) footer = t.slice(i, i + 130);
  }
  return JSON.stringify({ center: center, zoom: zoom, footer: footer, expected: { lat: 21.0287, lng: 105.8524 } });
})()
