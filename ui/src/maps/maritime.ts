// Live & active maritime traffic: ships at sea along major global shipping lanes and oceans.
import type * as ML from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { MapLib } from './core';

export interface Vessel {
  id: string;
  name: string;
  vesselType: 'container' | 'tanker' | 'research' | 'cruise' | 'naval' | 'icebreaker' | 'cargo';
  flag: string;
  callsign: string;
  mmsi: string;
  speedKnots: number;
  headingDeg: number;
  lat: number;
  lon: number;
  destination: string;
  eta?: string;
  lengthMeters: number;
  beamMeters: number;
  draughtMeters: number;
  desc: string;
  highlight?: string;
}

export const VESSELS_AT_SEA: Vessel[] = [
  // ── ULTRA LARGE CONTAINER VESSELS ───────────────────────────────────────
  {
    id: 'ever-given',
    name: 'Ever Given',
    vesselType: 'container',
    flag: 'Panama',
    callsign: 'H3RC',
    mmsi: '353136000',
    speedKnots: 17.8,
    headingDeg: 135,
    lat: 12.6500,
    lon: 43.3200,
    destination: 'Singapore (SGSIN)',
    eta: 'Oct 14 06:00',
    lengthMeters: 400,
    beamMeters: 59,
    draughtMeters: 14.5,
    desc: 'Golden-class 20,124 TEU container ship, famously grounded in the Suez Canal in March 2021 for six days. Currently transiting the Bab-el-Mandeb Strait bound for Asia.',
    highlight: 'One of the largest container ships afloat, measuring 400 meters long—longer than the Eiffel Tower is tall.',
  },
  {
    id: 'msc-irina',
    name: 'MSC Irina',
    vesselType: 'container',
    flag: 'Liberia',
    callsign: '5LDE4',
    mmsi: '636021876',
    speedKnots: 19.4,
    headingDeg: 78,
    lat: 5.8200,
    lon: 80.5100,
    destination: 'Yantian, Shenzhen (CNYTN)',
    eta: 'Oct 11 18:00',
    lengthMeters: 399.9,
    beamMeters: 61.3,
    draughtMeters: 16.0,
    desc: 'Among the highest-capacity container ships in the world, rated at 24,346 TEU with containers stacked up to 26 layers high. Transiting south of Sri Lanka across the Indian Ocean.',
    highlight: 'Equipped with hybrid exhaust scrubbers and air lubrication technology to reduce hull water friction.',
  },
  {
    id: 'cma-cgm-saade',
    name: 'CMA CGM Jacques Saadé',
    vesselType: 'container',
    flag: 'France',
    callsign: 'FMSS',
    mmsi: '228386800',
    speedKnots: 18.2,
    headingDeg: 260,
    lat: 36.1400,
    lon: -5.3500,
    destination: 'Rotterdam (NLRTM)',
    eta: 'Oct 09 14:00',
    lengthMeters: 400,
    beamMeters: 61,
    draughtMeters: 15.8,
    desc: 'Flagship of CMA CGM, the first 23,000 TEU ultra-large container ship powered by liquefied natural gas (LNG). Entering the Strait of Gibraltar toward northern Europe.',
    highlight: 'Carries an internal 18,600 cubic meter cryogenic fuel tank cooled to -161°C to store liquefied natural gas.',
  },
  {
    id: 'madrid-maersk',
    name: 'Madrid Maersk',
    vesselType: 'container',
    flag: 'Denmark',
    callsign: 'OWGH2',
    mmsi: '219836000',
    speedKnots: 16.5,
    headingDeg: 310,
    lat: 1.2200,
    lon: 103.8500,
    destination: 'Tanjung Pelepas (MYTPP)',
    eta: 'Oct 06 02:00',
    lengthMeters: 399,
    beamMeters: 58.6,
    draughtMeters: 15.2,
    desc: 'Second-generation Triple-E class container ship (20,568 TEU). Navigating the bustling Malacca / Singapore Strait corridor, the world’s busiest maritime transit highway.',
    highlight: 'Twin propulsion system with ultra-long stroke diesel engines and waste heat recovery systems.',
  },

  // ── RESEARCH & DEEP-SEA EXPLORATION VESSELS ──────────────────────────────
  {
    id: 'rv-polarstern',
    name: 'RV Polarstern',
    vesselType: 'research',
    flag: 'Germany',
    callsign: 'DBLK',
    mmsi: '211202460',
    speedKnots: 11.2,
    headingDeg: 15,
    lat: 78.9200,
    lon: 11.9300,
    destination: 'Fram Strait Arctic Science',
    lengthMeters: 118,
    beamMeters: 25,
    draughtMeters: 11.2,
    desc: 'Legendary polar research icebreaker operated by the Alfred Wegener Institute. Famous for the year-long MOSAiC Arctic climate drift expedition (2019–2020). Operating in the Arctic Fram Strait.',
    highlight: 'Can break through 1.5-meter-thick pack ice continuously at 5 knots and operate in temperatures down to -50°C.',
  },
  {
    id: 'ev-nautilus',
    name: 'E/V Nautilus',
    vesselType: 'research',
    flag: 'St. Vincent',
    callsign: 'J8B3654',
    mmsi: '377907176',
    speedKnots: 9.8,
    headingDeg: 210,
    lat: 21.3000,
    lon: -157.8600,
    destination: 'Papahānaumokuākea Deep Ridge',
    lengthMeters: 64,
    beamMeters: 10.5,
    draughtMeters: 4.9,
    desc: 'Ocean Exploration Trust exploration vessel directed by Dr. Robert Ballard. Equipped with ROVs Hercules and Argus for live-streaming deep-sea archaeology and hydrothermal vent geology.',
    highlight: 'Broadcasts 24/7 high-definition ROV video from unexplored abyssal seamounts to audiences worldwide.',
  },
  {
    id: 'okeanos-explorer',
    name: 'NOAA Ship Okeanos Explorer',
    vesselType: 'research',
    flag: 'United States',
    callsign: 'WTDH',
    mmsi: '369970591',
    speedKnots: 10.5,
    headingDeg: 340,
    lat: 25.7600,
    lon: -79.2000,
    destination: 'Blake Plateau Deep Survey',
    lengthMeters: 68.3,
    beamMeters: 13.1,
    draughtMeters: 5.1,
    desc: 'America’s dedicated ship for ocean exploration, operated by the NOAA Office of Ocean Exploration and Research. Equipped with telepresence satellite links and Deep Discoverer ROV.',
    highlight: 'Systematically maps uncharted US exclusive economic zone waters using high-resolution multibeam sonar.',
  },
  {
    id: 'david-attenborough',
    name: 'RRS Sir David Attenborough',
    vesselType: 'research',
    flag: 'United Kingdom',
    callsign: 'ZDLS1',
    mmsi: '232029580',
    speedKnots: 12.0,
    headingDeg: 195,
    lat: -54.2800,
    lon: -36.5000,
    destination: 'Rothera Research Station, Antarctica',
    lengthMeters: 129,
    beamMeters: 24,
    draughtMeters: 9.0,
    desc: 'State-of-the-art British Antarctic Survey polar research vessel (famously nicknamed "Boaty McBoatface" during a public vote). Operating in the Southern Ocean near South Georgia.',
    highlight: 'Equipped with a scientific "moon pool"—a vertical 4x4m shaft through the center of the ship allowing instruments to be deployed directly through sea ice.',
  },

  // ── SUPERTANKERS & GAS CARRIERS ──────────────────────────────────────────
  {
    id: 'ti-europe',
    name: 'TI Europe',
    vesselType: 'tanker',
    flag: 'Belgium',
    callsign: 'ONFB',
    mmsi: '205423000',
    speedKnots: 14.2,
    headingDeg: 95,
    lat: 26.2000,
    lon: 56.4000,
    destination: 'Strait of Hormuz Transit',
    lengthMeters: 380,
    beamMeters: 68,
    draughtMeters: 24.5,
    desc: 'One of only four Ultra Large Crude Carriers (ULCC) in the TI class, the largest ocean-going vessels currently afloat by gross tonnage. Entering the Strait of Hormuz laden with 3 million barrels of oil.',
    highlight: 'Has a deadweight tonnage of over 441,500 metric tons and a loaded draught of nearly 25 meters, too deep to transit the Suez or Panama Canal.',
  },
  {
    id: 'q-max-rasheeda',
    name: 'Rasheeda (Q-Max LNG)',
    vesselType: 'tanker',
    flag: 'Marshall Islands',
    callsign: 'V7SP2',
    mmsi: '538003714',
    speedKnots: 18.0,
    headingDeg: 275,
    lat: 27.5000,
    lon: 51.5000,
    destination: 'Isle of Grain (GBIOG)',
    lengthMeters: 345,
    beamMeters: 53.8,
    draughtMeters: 12.0,
    desc: 'Q-Max class membrane-type LNG carrier, the largest liquefied natural gas carrier in the world, holding 266,000 cubic meters of LNG cooled to -162°C.',
    highlight: 'Transports enough natural gas in a single voyage to supply the entire energy needs of the UK for an entire day.',
  },

  // ── LEGENDARY LINERS & CRUISE SHIPS ──────────────────────────────────────
  {
    id: 'queen-mary-2',
    name: 'RMS Queen Mary 2',
    vesselType: 'cruise',
    flag: 'Bermuda',
    callsign: 'ZCEF6',
    mmsi: '310627000',
    speedKnots: 23.5,
    headingDeg: 260,
    lat: 44.8000,
    lon: -38.5000,
    destination: 'New York (USNYC)',
    eta: 'Oct 08 07:00',
    lengthMeters: 345,
    beamMeters: 41,
    draughtMeters: 10.3,
    desc: 'The only true purpose-built transatlantic ocean liner in commercial service today. Cruising at 23.5 knots across the mid-Atlantic from Southampton to New York.',
    highlight: 'Features a reinforced deep-draft ocean liner hull with a flared bow and 40% thicker steel plating designed to punch through North Atlantic storms.',
  },
  {
    id: 'icon-of-the-seas',
    name: 'Icon of the Seas',
    vesselType: 'cruise',
    flag: 'Bahamas',
    callsign: 'C6FN6',
    mmsi: '311001147',
    speedKnots: 20.1,
    headingDeg: 120,
    lat: 23.8000,
    lon: -77.3000,
    destination: 'Perfect Day at CocoCay (BSCPY)',
    lengthMeters: 365,
    beamMeters: 48.5,
    draughtMeters: 9.3,
    desc: 'The largest cruise ship in the world by gross tonnage (248,663 GT), carrying up to 7,600 passengers and 2,350 crew members. Cruising in the Bahamas.',
    highlight: 'Features the world’s largest waterpark at sea (Category 6) with six record-breaking waterslides.',
  },

  // ── POLAR ICEBREAKERS & HISTORIC SHIPS ────────────────────────────────────
  {
    id: '50-let-pobedy',
    name: '50 Let Pobedy (50 Years of Victory)',
    vesselType: 'icebreaker',
    flag: 'Russia',
    callsign: 'UGTG',
    mmsi: '273133300',
    speedKnots: 15.0,
    headingDeg: 45,
    lat: 73.5000,
    lon: 55.2000,
    destination: 'Northern Sea Route Transit',
    lengthMeters: 159.6,
    beamMeters: 30,
    draughtMeters: 11.0,
    desc: 'Arktika-class nuclear-powered icebreaker with an innovative spoon-shaped bow. Escorts merchant convoys through thick pack ice along the Northern Sea Route.',
    highlight: 'Powered by two OK-900A nuclear reactors generating 75,000 shaft horsepower, capable of carving channels through 2.8-meter-thick Arctic ice.',
  },
  {
    id: 'amerigo-vespucci',
    name: 'Amerigo Vespucci',
    vesselType: 'naval',
    flag: 'Italy',
    callsign: 'IAVF',
    mmsi: '247999000',
    speedKnots: 8.5,
    headingDeg: 180,
    lat: -34.6000,
    lon: -58.3800,
    destination: 'Buenos Aires (ARBA)',
    lengthMeters: 101,
    beamMeters: 15.5,
    draughtMeters: 7.3,
    desc: 'Full-rigged three-masted tall ship and training vessel for the Italian Navy, built in 1930. Revered globally as "the most beautiful ship in the world."',
    highlight: 'Carries 26 traditional canvas sails spanning 2,635 square meters, all handled completely manually with natural hemp rigging.',
  },
  {
    id: 'uss-gerald-ford',
    name: 'USS Gerald R. Ford (CVN-78)',
    vesselType: 'naval',
    flag: 'United States',
    callsign: 'NNRF',
    mmsi: '369970999',
    speedKnots: 27.0,
    headingDeg: 105,
    lat: 34.5000,
    lon: 26.5000,
    destination: 'Eastern Mediterranean Patrol',
    lengthMeters: 337,
    beamMeters: 78,
    draughtMeters: 12.0,
    desc: 'Lead ship of the Ford-class nuclear-powered aircraft carriers, the most technologically advanced warship ever constructed. Features electromagnetic aircraft launch systems (EMALS).',
    highlight: 'Powered by two Bechtel A1B nuclear reactors producing enough electrical power to supply a city of 300,000 residents for 25 years without refueling.',
  },
];

const SRC = 'sb-maritime';
const LAYER_VESSEL = 'sb-maritime-vessel';
const LAYER_LABEL = 'sb-maritime-label';
const LAYER_PULSE = 'sb-maritime-pulse';

export interface MaritimeLayer {
  detach: () => void;
  select: (id: string | null) => void;
}

export function attachMaritime(
  lib: MapLib,
  map: ML.Map,
  onSelect: (vessel: Vessel | null) => void
): MaritimeLayer {
  void lib;
  let selectedId: string | null = null;
  let gone = false;

  const toGeoJSON = (): FeatureCollection => ({
    type: 'FeatureCollection',
    features: VESSELS_AT_SEA.map(v => ({
      type: 'Feature',
      properties: {
        id: v.id,
        name: v.name,
        vesselType: v.vesselType,
        flag: v.flag,
        speedKnots: v.speedKnots,
        headingDeg: v.headingDeg,
        destination: v.destination,
        sel: v.id === selectedId,
      },
      geometry: {
        type: 'Point',
        coordinates: [v.lon, v.lat],
      },
    })),
  });

  if (!map.getSource(SRC)) {
    map.addSource(SRC, {
      type: 'geojson',
      data: toGeoJSON(),
    });
  }

  // Radar wake / position pulse
  if (!map.getLayer(LAYER_PULSE)) {
    map.addLayer({
      id: LAYER_PULSE,
      type: 'circle',
      source: SRC,
      paint: {
        'circle-radius': ['case', ['get', 'sel'], 16, 9],
        'circle-color': '#10b981',
        'circle-opacity': 0.35,
        'circle-blur': 0.7,
      },
    });
  }

  // Vessel hull indicator
  if (!map.getLayer(LAYER_VESSEL)) {
    map.addLayer({
      id: LAYER_VESSEL,
      type: 'circle',
      source: SRC,
      paint: {
        'circle-radius': ['case', ['get', 'sel'], 6.5, 4.5],
        'circle-color': ['case', ['get', 'sel'], '#34d399', '#059669'],
        'circle-stroke-color': '#022c22',
        'circle-stroke-width': 1.5,
      },
    });
  }

  // Vessel label & speed
  if (!map.getLayer(LAYER_LABEL)) {
    map.addLayer({
      id: LAYER_LABEL,
      type: 'symbol',
      source: SRC,
      layout: {
        'text-field': ['concat', ['get', 'name'], ' · ', ['to-string', ['get', 'speedKnots']], ' kn'],
        'text-font': ['Noto Sans Medium'],
        'text-size': 9.5,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: {
        'text-color': '#d1fae5',
        'text-halo-color': '#022c22',
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
      const v = VESSELS_AT_SEA.find(x => x.id === id);
      onSelect(v ?? null);
    }
  };

  const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
  const onLeave = () => { map.getCanvas().style.cursor = ''; };

  map.on('click', LAYER_VESSEL, onClick);
  map.on('mouseenter', LAYER_VESSEL, onEnter);
  map.on('mouseleave', LAYER_VESSEL, onLeave);

  function select(id: string | null) {
    selectedId = id;
    const src = map.getSource(SRC) as ML.GeoJSONSource | undefined;
    if (src) src.setData(toGeoJSON());
  }

  return {
    select,
    detach: () => {
      gone = true;
      map.off('click', LAYER_VESSEL, onClick);
      map.off('mouseenter', LAYER_VESSEL, onEnter);
      map.off('mouseleave', LAYER_VESSEL, onLeave);
      try {
        if (map.getLayer(LAYER_LABEL)) map.removeLayer(LAYER_LABEL);
        if (map.getLayer(LAYER_VESSEL)) map.removeLayer(LAYER_VESSEL);
        if (map.getLayer(LAYER_PULSE)) map.removeLayer(LAYER_PULSE);
        if (map.getSource(SRC)) map.removeSource(SRC);
      } catch {}
    },
  };
}
