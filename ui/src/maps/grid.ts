// Coordinate graticule grid (parallels, meridians, equator, tropics) for planetary cartography.
import type * as ML from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';

export function generateGraticule(): FeatureCollection {
  const features: Feature[] = [];

  // Parallels (latitude lines) every 15 degrees
  const latSteps = [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75];
  for (const lat of latSteps) {
    const coords: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 5) {
      coords.push([lon, lat]);
    }
    const isEquator = lat === 0;
    features.push({
      type: 'Feature',
      properties: {
        type: isEquator ? 'equator' : 'parallel',
        label: isEquator ? '0° Equator' : `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`,
      },
      geometry: { type: 'LineString', coordinates: coords },
    });

    // Label point at prime meridian
    features.push({
      type: 'Feature',
      properties: {
        type: 'label',
        label: isEquator ? 'Equator 0°' : `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`,
      },
      geometry: { type: 'Point', coordinates: [0, lat] },
    });
  }

  // Meridians (longitude lines) every 30 degrees
  const lonSteps = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180];
  for (const lon of lonSteps) {
    const coords: [number, number][] = [];
    for (let lat = -85; lat <= 85; lat += 5) {
      coords.push([lon, lat]);
    }
    const isPrime = lon === 0;
    features.push({
      type: 'Feature',
      properties: {
        type: isPrime ? 'prime' : 'meridian',
        label: isPrime ? '0° Prime Meridian' : `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`,
      },
      geometry: { type: 'LineString', coordinates: coords },
    });

    // Label point at equator
    if (lon !== 0 && Math.abs(lon) < 180) {
      features.push({
        type: 'Feature',
        properties: {
          type: 'label',
          label: `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`,
        },
        geometry: { type: 'Point', coordinates: [lon, 0] },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

const SRC = 'sb-graticule';
const LAYER_EQUATOR = 'sb-graticule-equator';
const LAYER_PRIME = 'sb-graticule-prime';
const LAYER_LINES = 'sb-graticule-lines';
const LAYER_LABELS = 'sb-graticule-labels';

export function attachGrid(map: ML.Map): { detach: () => void } {
  if (!map.getSource(SRC)) {
    map.addSource(SRC, {
      type: 'geojson',
      data: generateGraticule(),
    });

    // General parallels and meridians
    map.addLayer({
      id: LAYER_LINES,
      type: 'line',
      source: SRC,
      filter: ['in', ['get', 'type'], ['literal', ['parallel', 'meridian']]],
      paint: {
        'line-color': '#94a3b8',
        'line-width': 1,
        'line-opacity': 0.25,
        'line-dasharray': [2, 2],
      },
    });

    // Equator (emphasized cyan line)
    map.addLayer({
      id: LAYER_EQUATOR,
      type: 'line',
      source: SRC,
      filter: ['==', ['get', 'type'], 'equator'],
      paint: {
        'line-color': '#06b6d4',
        'line-width': 1.5,
        'line-opacity': 0.6,
      },
    });

    // Prime Meridian (emphasized amber line)
    map.addLayer({
      id: LAYER_PRIME,
      type: 'line',
      source: SRC,
      filter: ['==', ['get', 'type'], 'prime'],
      paint: {
        'line-color': '#f59e0b',
        'line-width': 1.5,
        'line-opacity': 0.6,
      },
    });

    // Labels
    map.addLayer({
      id: LAYER_LABELS,
      type: 'symbol',
      source: SRC,
      filter: ['==', ['get', 'type'], 'label'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-offset': [0.5, 0.5],
        'text-anchor': 'top-left',
        'text-optional': true,
      },
      paint: {
        'text-color': '#94a3b8',
        'text-halo-color': '#06070c',
        'text-halo-width': 2,
        'text-opacity': 0.7,
      },
    });
  }

  return {
    detach: () => {
      if (map.getLayer(LAYER_LABELS)) map.removeLayer(LAYER_LABELS);
      if (map.getLayer(LAYER_PRIME)) map.removeLayer(LAYER_PRIME);
      if (map.getLayer(LAYER_EQUATOR)) map.removeLayer(LAYER_EQUATOR);
      if (map.getLayer(LAYER_LINES)) map.removeLayer(LAYER_LINES);
      if (map.getSource(SRC)) map.removeSource(SRC);
    },
  };
}
