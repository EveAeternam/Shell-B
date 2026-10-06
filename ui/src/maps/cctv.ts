// Live public CCTV webcams and streaming city cameras worldwide.
import type * as ML from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { MapLib } from './core';

export interface CCTVCamera {
  id: string;
  name: string;
  location: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  status: 'live' | 'intermittent' | 'daylight-only';
  resolution: string;
  streamUrl: string;
  viewAngle: string;
  timezone: string;
  desc: string;
  highlight?: string;
}

export const CCTV_CAMERAS: CCTVCamera[] = [
  {
    id: 'iss-hdev',
    name: 'ISS HD Earth Viewing (Nadir & Forward)',
    location: 'Low Earth Orbit (420 km altitude)',
    city: 'International Space Station',
    country: 'Space (NASA / ESA / JAXA)',
    lat: 0.0, // dynamically follows ISS or centered on equator
    lon: 0.0,
    status: 'live',
    resolution: '1080p HD',
    streamUrl: 'https://www.youtube.com/watch?v=P9C25Un7xaM',
    viewAngle: 'Nadir orbital view looking straight down at Earth',
    timezone: 'UTC',
    desc: 'Live high-definition streaming cameras mounted on the exterior of the International Space Station, orbiting Earth every 92 minutes at 27,600 km/h.',
    highlight: 'Witness 16 sunrises and sunsets every 24 hours, aurora ribbons, city night lights, and ocean cloud eddies from space.',
  },
  {
    id: 'times-square',
    name: 'Times Square (Broadway & 46th St)',
    location: 'Duffy Square / Father Duffy Plaza',
    city: 'New York City',
    country: 'United States',
    lat: 40.7580,
    lon: -73.9855,
    status: 'live',
    resolution: '4K Ultra HD',
    streamUrl: 'https://www.earthcam.com/usa/newyork/timessquare/?cam=tsrobo1',
    viewAngle: 'Southbound panoramic view over Broadway and 7th Avenue',
    timezone: 'America/New_York (EST/EDT)',
    desc: 'The "Crossroads of the World", bathed in neon and towering digital billboards, with hundreds of thousands of pedestrians passing daily.',
    highlight: 'Site of the iconic New Year’s Eve ball drop; bustling 24/7 with yellow cabs and street performers.',
  },
  {
    id: 'shibuya-scramble',
    name: 'Shibuya Crossing (Hachiko Scramble)',
    location: 'Shibuya Station Hachiko Exit',
    city: 'Tokyo',
    country: 'Japan',
    lat: 35.6595,
    lon: 139.7005,
    status: 'live',
    resolution: '1080p 60fps',
    streamUrl: 'https://www.youtube.com/watch?v=HpdO5Kq3o7Y',
    viewAngle: 'Overhead view looking down from QFRONT building',
    timezone: 'Asia/Tokyo (JST)',
    desc: 'The busiest pedestrian intersection in the world, where up to 3,000 people cross simultaneously during a single green light cycle.',
    highlight: 'Framed by giant LED advertising screens and the historic statue of the faithful dog Hachiko.',
  },
  {
    id: 'eiffel-tower',
    name: 'Eiffel Tower & Champ de Mars',
    location: 'Quai Branly / Pont d’Iéna',
    city: 'Paris',
    country: 'France',
    lat: 48.8584,
    lon: 2.2945,
    status: 'live',
    resolution: '1080p HD',
    streamUrl: 'https://www.skylinewebcams.com/en/webcam/france/ile-de-france/paris/tour-eiffel.html',
    viewAngle: 'Northwest view from Trocadéro across the Seine River',
    timezone: 'Europe/Paris (CET/CEST)',
    desc: 'The iron spire that defines the Parisian skyline, designed by Gustave Eiffel for the 1889 Exposition Universelle.',
    highlight: 'Features its sparkling golden beacon sweep and five-minute light show every hour on the hour after sunset.',
  },
  {
    id: 'venice-grand-canal',
    name: 'Venice Grand Canal & Rialto Bridge',
    location: 'Rialto Bridge (Ponte di Rialto)',
    city: 'Venice',
    country: 'Italy',
    lat: 45.4380,
    lon: 12.3358,
    status: 'live',
    resolution: '1080p HD',
    streamUrl: 'https://www.skylinewebcams.com/en/webcam/italia/veneto/venezia/ponte-di-rialto.html',
    viewAngle: 'Facing south along the S-curve waterway of the Grand Canal',
    timezone: 'Europe/Rome (CET/CEST)',
    desc: 'The primary water artery of Venice, filled with passing vaporetti (water buses), gondolas, and ornate Venetian Gothic palazzi.',
    highlight: 'Captures the oldest of the four bridges spanning the Grand Canal, completed in stone in 1591.',
  },
  {
    id: 'abbey-road',
    name: 'Abbey Road Zebra Crossing',
    location: 'Abbey Road & Grove End Road',
    city: 'London',
    country: 'United Kingdom',
    lat: 51.5320,
    lon: -0.1774,
    status: 'live',
    resolution: '1080p HD',
    streamUrl: 'https://www.abbeyroad.com/crossing',
    viewAngle: 'Direct roadside view of the pedestrian crossing outside Abbey Road Studios',
    timezone: 'Europe/London (GMT/BST)',
    desc: 'The Grade II listed pedestrian zebra crossing made legendary by the Beatles’ 1969 album cover photograph.',
    highlight: 'Music fans from across the globe recreate the famous barefoot walk every minute of the day.',
  },
  {
    id: 'old-faithful',
    name: 'Old Faithful Geyser',
    location: 'Upper Geyser Basin, Yellowstone National Park',
    city: 'Wyoming',
    country: 'United States',
    lat: 44.4605,
    lon: -110.8281,
    status: 'live',
    resolution: '1080p HD',
    streamUrl: 'https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm',
    viewAngle: 'Westward panoramic view across the sinter geyser cone',
    timezone: 'America/Denver (MST/MDT)',
    desc: 'Yellowstone’s famous cone geyser, erupting reliably every 60 to 110 minutes, shooting boiling geothermal water up to 55 meters into the mountain air.',
    highlight: 'Powered by the immense magma chamber of the Yellowstone supervolcano beneath the caldera.',
  },
  {
    id: 'colosseum-cam',
    name: 'Colosseum & Roman Forum Panorama',
    location: 'Piazza del Colosseo',
    city: 'Rome',
    country: 'Italy',
    lat: 41.8902,
    lon: 12.4922,
    status: 'live',
    resolution: '4K Ultra HD',
    streamUrl: 'https://www.skylinewebcams.com/en/webcam/italia/lazio/roma/colosseo.html',
    viewAngle: 'Southwest view of the outer travertine arches and Arch of Constantine',
    timezone: 'Europe/Rome (CET/CEST)',
    desc: 'Ancient Rome’s grand arena, illuminated dramatically at dusk with amber floodlights.',
    highlight: 'Overlooks the Gladiators’ entrance and the ancient Via dei Fori Imperiali.',
  },
  {
    id: 'bondi-beach',
    name: 'Bondi Beach & Surf Cam',
    location: 'Bondi Pavilion, Queen Elizabeth Drive',
    city: 'Sydney',
    country: 'Australia',
    lat: -33.8915,
    lon: 151.2767,
    status: 'live',
    resolution: '1080p HD',
    streamUrl: 'https://www.coastalwatch.com/surf-cams-surf-reports/nsw/bondi-beach',
    viewAngle: 'Sweeping view across the crescent bay and southern ocean swell',
    timezone: 'Australia/Sydney (AEST/AEDT)',
    desc: 'Australia’s most famous golden sand beach, world-renowned for its turquoise ocean breakers, boardriders, and lifeguard patrols.',
    highlight: 'Overlooks Bondi Icebergs ocean pool where Pacific swells crash directly over the baths.',
  },
  {
    id: 'niagara-falls',
    name: 'Niagara Falls (Horseshoe Falls)',
    location: 'Table Rock Welcome Centre',
    city: 'Niagara Falls',
    country: 'Canada / USA',
    lat: 43.0799,
    lon: -79.0747,
    status: 'live',
    resolution: '4K Ultra HD',
    streamUrl: 'https://www.earthcam.com/canada/niagarafalls/?cam=niagarafalls_hd',
    viewAngle: 'Direct overhead view into the churning mist of the Horseshoe cascade',
    timezone: 'America/Toronto (EST/EDT)',
    desc: 'Massive cataract dropping 51 meters, pouring over 2,800 cubic meters of water per second from the Great Lakes into the Niagara Gorge.',
    highlight: 'Lit with colorful LED floodlights and weekend fireworks reflecting off roaring mist clouds.',
  },
  {
    id: 'las-vegas-strip',
    name: 'Las Vegas Strip & Bellagio Fountains',
    location: 'Las Vegas Boulevard South',
    city: 'Las Vegas',
    country: 'United States',
    lat: 36.1126,
    lon: -115.1767,
    status: 'live',
    resolution: '4K Ultra HD',
    streamUrl: 'https://www.earthcam.com/usa/nevada/lasvegas/index.php?cam=bellagio',
    viewAngle: 'Northward view across the 8-acre Bellagio lake and neon Strip corridor',
    timezone: 'America/Los_Angeles (PST/PDT)',
    desc: 'The neon entertainment capital of the world, capturing the choreographed water, music, and light performances of the Bellagio fountains.',
    highlight: 'Shoots water plumes up to 140 meters high synchronized to opera, Broadway, and classic pop music.',
  },
  {
    id: 'mount-fuji-lake',
    name: 'Mount Fuji (Lake Kawaguchiko Overlook)',
    location: 'Fujikawaguchiko, Yamanashi Prefecture',
    city: 'Mount Fuji',
    country: 'Japan',
    lat: 35.5170,
    lon: 138.7518,
    status: 'live',
    resolution: '1080p HD',
    streamUrl: 'https://www.youtube.com/watch?v=8q-pT6Gz00U',
    viewAngle: 'Southward view across the calm waters of Lake Kawaguchi toward the volcanic cone',
    timezone: 'Asia/Tokyo (JST)',
    desc: 'Japan’s sacred composite stratovolcano, rising symmetrically to 3,776 meters with its iconic snow-capped summit.',
    highlight: 'Famous for creating the "Double Fuji" (Upside-down Fuji) reflection on the tranquil lake surface at dawn.',
  },
  {
    id: 'trevi-fountain',
    name: 'Trevi Fountain (Fontana di Trevi)',
    location: 'Piazza di Trevi',
    city: 'Rome',
    country: 'Italy',
    lat: 41.9009,
    lon: 12.4833,
    status: 'live',
    resolution: '1080p HD',
    streamUrl: 'https://www.skylinewebcams.com/en/webcam/italia/lazio/roma/fontana-di-trevi.html',
    viewAngle: 'Direct view of the travertine facade and Oceanus chariot pool',
    timezone: 'Europe/Rome (CET/CEST)',
    desc: 'The largest Baroque fountain in Rome, designed by Nicola Salvi against the facade of the Palazzo Poli.',
    highlight: 'Legend holds that throwing a coin over your left shoulder with your right hand ensures your return to the Eternal City.',
  },
  {
    id: 'copacabana-beach',
    name: 'Copacabana Beach & Atlantic Promenade',
    location: 'Avenida Atlântica',
    city: 'Rio de Janeiro',
    country: 'Brazil',
    lat: -22.9698,
    lon: -43.1802,
    status: 'live',
    resolution: '1080p HD',
    streamUrl: 'https://www.skylinewebcams.com/en/webcam/brasil/rio-de-janeiro/rio-de-janeiro/copacabana.html',
    viewAngle: 'Southwest view along the 4 km crescent beach and wave-pattern mosaic sidewalk',
    timezone: 'America/Sao_Paulo (BRT)',
    desc: 'Rio’s world-famous 4-kilometer Atlantic beach, framed by Sugarloaf Mountain and vibrant beach football and footvolley culture.',
    highlight: 'Features the geometric black-and-white Portuguese wave pavement designed by Roberto Burle Marx.',
  },
  {
    id: 'santa-monica-pier',
    name: 'Santa Monica Pier & Route 66 End',
    location: 'Pacific Park, Ocean Avenue',
    city: 'Santa Monica, California',
    country: 'United States',
    lat: 34.0099,
    lon: -118.4960,
    status: 'live',
    resolution: '1080p HD',
    streamUrl: 'https://www.earthcam.com/usa/california/santamonica/?cam=santamonica',
    viewAngle: 'Ocean view looking out along the historic wooden pier and solar-powered Ferris wheel',
    timezone: 'America/Los_Angeles (PST/PDT)',
    desc: 'Historic double-jointed wooden pier marking the official western terminus of legendary US Route 66 at the edge of the Pacific Ocean.',
    highlight: 'Features Pacific Park’s solar-powered Ferris wheel glowing above the Pacific surf at golden hour.',
  },
  {
    id: 'santorini-caldera',
    name: 'Santorini Caldera & Oia Village',
    location: 'Oia Cliffside',
    city: 'Santorini, Cyclades',
    country: 'Greece',
    lat: 36.4618,
    lon: 25.3753,
    status: 'live',
    resolution: '4K Ultra HD',
    streamUrl: 'https://www.skylinewebcams.com/en/webcam/ellada/cyclades/santorini/oia-santorini.html',
    viewAngle: 'Southward view over whitewashed cave houses and blue-domed churches',
    timezone: 'Europe/Athens (EET/EEST)',
    desc: 'The dramatic volcanic amphitheater created by the catastrophic Minoan eruption 3,600 years ago, renowned for glowing Aegean sunsets.',
    highlight: 'Classic Greek island architecture of whitewashed caldera dwellings cascading down 300-meter volcanic cliff faces.',
  },
];

const SRC = 'sb-cctv';
const LAYER_PULSE = 'sb-cctv-pulse';
const LAYER_CIRCLE = 'sb-cctv-circle';
const LAYER_LABEL = 'sb-cctv-label';

export interface CCTVLayer {
  detach: () => void;
  select: (id: string | null) => void;
}

export function attachCCTV(
  lib: MapLib,
  map: ML.Map,
  onSelect: (cam: CCTVCamera | null) => void
): CCTVLayer {
  void lib;
  let selectedId: string | null = null;
  let gone = false;

  const toGeoJSON = (): FeatureCollection => ({
    type: 'FeatureCollection',
    features: CCTV_CAMERAS.map(c => ({
      type: 'Feature',
      properties: {
        id: c.id,
        name: c.name,
        city: c.city,
        country: c.country,
        status: c.status,
        resolution: c.resolution,
        sel: c.id === selectedId,
      },
      geometry: {
        type: 'Point',
        coordinates: [c.lon, c.lat],
      },
    })),
  });

  if (!map.getSource(SRC)) {
    map.addSource(SRC, {
      type: 'geojson',
      data: toGeoJSON(),
    });
  }

  // Pulsing red live recording indicator aura
  if (!map.getLayer(LAYER_PULSE)) {
    map.addLayer({
      id: LAYER_PULSE,
      type: 'circle',
      source: SRC,
      paint: {
        'circle-radius': ['case', ['get', 'sel'], 16, 10],
        'circle-color': '#ef4444',
        'circle-opacity': 0.4,
        'circle-blur': 0.7,
      },
    });
  }

  // Core camera lens pin
  if (!map.getLayer(LAYER_CIRCLE)) {
    map.addLayer({
      id: LAYER_CIRCLE,
      type: 'circle',
      source: SRC,
      paint: {
        'circle-radius': ['case', ['get', 'sel'], 6.5, 4.5],
        'circle-color': ['case', ['get', 'sel'], '#f87171', '#dc2626'],
        'circle-stroke-color': '#450a0a',
        'circle-stroke-width': 1.5,
      },
    });
  }

  // CCTV camera label
  if (!map.getLayer(LAYER_LABEL)) {
    map.addLayer({
      id: LAYER_LABEL,
      type: 'symbol',
      source: SRC,
      layout: {
        'text-field': ['concat', '📹 ', ['get', 'name']],
        'text-font': ['Noto Sans Medium'],
        'text-size': 9.5,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: {
        'text-color': '#fee2e2',
        'text-halo-color': '#280505',
        'text-halo-width': 1.4,
      },
    });
  }

  const onClick = (e: ML.MapLayerMouseEvent) => {
    if (gone) return;
    const feat = e.features?.[0];
    const id = feat?.properties?.id;
    if (id) {
      select(String(id));
      const cam = CCTV_CAMERAS.find(x => x.id === id);
      onSelect(cam ?? null);
    }
  };

  const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const onLeave = () => { map.getCanvas().style.cursor = ''; };

  map.on('click', LAYER_CIRCLE, onClick);
  map.on('mouseenter', LAYER_CIRCLE, onEnter);
  map.on('mouseleave', LAYER_CIRCLE, onLeave);

  function select(id: string | null) {
    selectedId = id;
    const src = map.getSource(SRC) as ML.GeoJSONSource | undefined;
    if (src) src.setData(toGeoJSON());
  }

  return {
    select,
    detach: () => {
      gone = true;
      map.off('click', LAYER_CIRCLE, onClick);
      map.off('mouseenter', LAYER_CIRCLE, onEnter);
      map.off('mouseleave', LAYER_CIRCLE, onLeave);
      try {
        if (map.getLayer(LAYER_LABEL)) map.removeLayer(LAYER_LABEL);
        if (map.getLayer(LAYER_CIRCLE)) map.removeLayer(LAYER_CIRCLE);
        if (map.getLayer(LAYER_PULSE)) map.removeLayer(LAYER_PULSE);
        if (map.getSource(SRC)) map.removeSource(SRC);
      } catch {}
    },
  };
}
