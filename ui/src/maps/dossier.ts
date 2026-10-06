// Comprehensive scientific profiles and physical characteristics for Solar System bodies.

export interface WorldDossier {
  id: string;
  name: string;
  category: string;
  tagline: string;
  radiusKm: number;
  massKg: string;
  massEarth: string;
  surfaceGravityMs2: number;
  surfaceGravityG: number;
  escapeVelocityKms: number;
  solarDay: string;
  siderealPeriod: string;
  orbitalPeriod: string;
  distanceFromPrimary: string;
  eccentricity: number;
  inclinationDeg: number;
  axialTiltDeg: number;
  surfaceTempMinC: number;
  surfaceTempMeanC: number;
  surfaceTempMaxC: number;
  surfacePressure: string;
  atmosphere: string[];
  features: string[];
  geologySummary: string;
}

export const DOSSIERS: Record<string, WorldDossier> = {
  earth: {
    id: 'earth', name: 'Earth', category: 'Terrestrial Planet',
    tagline: 'The third planet from the Sun and the only known harbor of life.',
    radiusKm: 6371.0,
    massKg: '5.972 × 10²⁴ kg',
    massEarth: '1.000 M⊕',
    surfaceGravityMs2: 9.807,
    surfaceGravityG: 1.000,
    escapeVelocityKms: 11.186,
    solarDay: '24 hours 00 min',
    siderealPeriod: '23h 56m 04s',
    orbitalPeriod: '365.256 days (1.00 yr)',
    distanceFromPrimary: '1.000 AU (149.6 million km)',
    eccentricity: 0.0167,
    inclinationDeg: 0.000,
    axialTiltDeg: 23.44,
    surfaceTempMinC: -89.2,
    surfaceTempMeanC: 15.0,
    surfaceTempMaxC: 56.7,
    surfacePressure: '1,013.25 hPa (1.0 atm)',
    atmosphere: ['78.08% Nitrogen (N₂)', '20.95% Oxygen (O₂)', '0.93% Argon (Ar)', '0.04% Carbon dioxide (CO₂)'],
    features: ['Hydrosphere covers 70.8% of surface', 'Active plate tectonics', 'Strong dipole magnetosphere protecting biosphere', 'Single large natural satellite (Moon)'],
    geologySummary: 'Dynamic crust driven by convective mantle plumes and plate subduction. Continental granitic crust averages 35 km thick while basaltic oceanic crust averages 7 km.'
  },
  moon: {
    id: 'moon', name: 'Moon (Luna)', category: 'Natural Satellite',
    tagline: 'Earth’s only natural satellite and the fifth-largest moon in the Solar System.',
    radiusKm: 1737.4,
    massKg: '7.342 × 10²² kg',
    massEarth: '0.0123 M⊕ (1.2% Earth)',
    surfaceGravityMs2: 1.622,
    surfaceGravityG: 0.165,
    escapeVelocityKms: 2.380,
    solarDay: '29.53 days (synodic)',
    siderealPeriod: '27.32 days (tidally locked)',
    orbitalPeriod: '27.322 days around Earth',
    distanceFromPrimary: '384,400 km (0.00257 AU)',
    eccentricity: 0.0549,
    inclinationDeg: 5.145,
    axialTiltDeg: 1.54,
    surfaceTempMinC: -246.0,
    surfaceTempMeanC: -20.0,
    surfaceTempMaxC: 121.0,
    surfacePressure: '~3 × 10⁻¹⁰ Pa (trace exosphere)',
    atmosphere: ['Trace Helium', 'Trace Neon', 'Trace Hydrogen', 'Trace Argon'],
    features: ['Dark volcanic basaltic maria on near side', 'Heavily cratered anorthosite far-side highlands', 'Permanently shadowed polar craters holding water ice', '1:1 tidal locking with Earth'],
    geologySummary: 'Differentiated body with iron-rich metallic core, mantle dominated by olivine and pyroxene, and an anorthosite-rich flotation crust formed in an ancient lunar magma ocean.'
  },
  mars: {
    id: 'mars', name: 'Mars', category: 'Terrestrial Planet',
    tagline: 'The Red Planet: a frozen desert world with towering volcanoes and ancient river valleys.',
    radiusKm: 3389.5,
    massKg: '6.417 × 10²³ kg',
    massEarth: '0.107 M⊕ (10.7% Earth)',
    surfaceGravityMs2: 3.721,
    surfaceGravityG: 0.379,
    escapeVelocityKms: 5.027,
    solarDay: '24 hours 39 min 35 sec (1 sol)',
    siderealPeriod: '24h 37m 22s',
    orbitalPeriod: '686.980 days (1.88 yr)',
    distanceFromPrimary: '1.524 AU (227.9 million km)',
    eccentricity: 0.0934,
    inclinationDeg: 1.850,
    axialTiltDeg: 25.19,
    surfaceTempMinC: -153.0,
    surfaceTempMeanC: -63.0,
    surfaceTempMaxC: 20.0,
    surfacePressure: '6.1 hPa (~0.6% Earth pressure)',
    atmosphere: ['95.32% Carbon dioxide (CO₂)', '2.60% Nitrogen (N₂)', '1.90% Argon (Ar)', '0.16% Oxygen (O₂)'],
    features: ['Olympus Mons (tallest planetary volcano in Sol)', 'Valles Marineris rift valley', 'Perennial water & dry ice polar ice caps', 'Ancient river deltas & clay-bearing paleolakes'],
    geologySummary: 'Marked crustal dichotomy: smooth northern lowlands flattened by ancient lava or ocean vs rugged, ancient southern cratered highlands.'
  },
  mercury: {
    id: 'mercury', name: 'Mercury', category: 'Terrestrial Planet',
    tagline: 'The smallest planet and closest to the Sun, subject to extreme temperature swings.',
    radiusKm: 2439.7,
    massKg: '3.301 × 10²³ kg',
    massEarth: '0.055 M⊕ (5.5% Earth)',
    surfaceGravityMs2: 3.700,
    surfaceGravityG: 0.377,
    escapeVelocityKms: 4.250,
    solarDay: '175.94 Earth days',
    siderealPeriod: '58.646 days (3:2 spin-orbit resonance)',
    orbitalPeriod: '87.969 days (0.24 yr)',
    distanceFromPrimary: '0.387 AU (57.9 million km)',
    eccentricity: 0.2056,
    inclinationDeg: 7.005,
    axialTiltDeg: 0.034,
    surfaceTempMinC: -180.0,
    surfaceTempMeanC: 167.0,
    surfaceTempMaxC: 430.0,
    surfacePressure: '1 × 10⁻¹⁴ bar (exosphere)',
    atmosphere: ['42% Oxygen', '29% Sodium', '22% Hydrogen', '6% Helium', '0.5% Potassium'],
    features: ['Massive metallic iron core occupying 85% of planetary radius', 'Caloris Planitia impact basin', 'Lobate scarps formed by planetary cooling contraction', 'Water ice deposits in permanently shadowed polar craters'],
    geologySummary: 'Extremely dense world dominated by a gargantuan iron-nickel core with a thin silicate mantle (~400 km). Lobate scarps reveal global crustal contraction of 7 km as the core cooled.'
  },
  venus: {
    id: 'venus', name: 'Venus', category: 'Terrestrial Planet',
    tagline: 'Earth’s twin in size, veiled in dense sulfuric acid clouds with a crushing runaway greenhouse.',
    radiusKm: 6051.8,
    massKg: '4.867 × 10²⁴ kg',
    massEarth: '0.815 M⊕ (81.5% Earth)',
    surfaceGravityMs2: 8.870,
    surfaceGravityG: 0.904,
    escapeVelocityKms: 10.360,
    solarDay: '116.75 Earth days',
    siderealPeriod: '243.023 days (retrograde rotation)',
    orbitalPeriod: '224.701 days (0.62 yr)',
    distanceFromPrimary: '0.723 AU (108.2 million km)',
    eccentricity: 0.0067,
    inclinationDeg: 3.394,
    axialTiltDeg: 177.36,
    surfaceTempMinC: 438.0,
    surfaceTempMeanC: 464.0,
    surfaceTempMaxC: 482.0,
    surfacePressure: '92,000 hPa (92 atm — equivalent to 900m ocean depth)',
    atmosphere: ['96.5% Carbon dioxide (CO₂)', '3.5% Nitrogen (N₂)', '0.015% Sulfur dioxide (SO₂)'],
    features: ['Hottest planetary surface in Solar System', 'Maxwell Montes (11 km summit)', 'Vast volcanic plains & pancake domes', 'Clouds of concentrated sulfuric acid droplets'],
    geologySummary: 'Completely resurfaced 300–500 million years ago by catastrophic volcanic outpouring. Lacks Earth-style plate tectonics; heat escapes through mantle plumes and coronae.'
  },
  ceres: {
    id: 'ceres', name: 'Ceres', category: 'Dwarf Planet',
    tagline: 'The largest object in the asteroid belt and an active ice-rock dwarf planet.',
    radiusKm: 469.7,
    massKg: '9.384 × 10²⁰ kg',
    massEarth: '0.000157 M⊕',
    surfaceGravityMs2: 0.280,
    surfaceGravityG: 0.029,
    escapeVelocityKms: 0.510,
    solarDay: '9 hours 04 min',
    siderealPeriod: '9h 04m 30s',
    orbitalPeriod: '1,682 days (4.60 yr)',
    distanceFromPrimary: '2.767 AU (413.9 million km)',
    eccentricity: 0.0758,
    inclinationDeg: 10.593,
    axialTiltDeg: 4.0,
    surfaceTempMinC: -143.0,
    surfaceTempMeanC: -106.0,
    surfaceTempMaxC: -38.0,
    surfacePressure: 'Negligible (intermittent water vapor exosphere)',
    atmosphere: ['Trace water vapor sublimated during solar flares'],
    features: ['Occator Crater Cerealia Facula bright salt deposits', 'Ahuna Mons cryovolcanic solitary mountain', 'Water ice comprises 40–50% by volume'],
    geologySummary: 'Differentiated asteroid with a rocky inner core and a water-ice/salt-rich mantle. May retain remnants of an ancient brine ocean beneath its crust.'
  },
  titan: {
    id: 'titan', name: 'Titan', category: 'Moon of Saturn',
    tagline: 'The only moon with a dense atmosphere and rivers, lakes, and seas of liquid hydrocarbons.',
    radiusKm: 2574.7,
    massKg: '1.345 × 10²³ kg',
    massEarth: '0.0225 M⊕',
    surfaceGravityMs2: 1.352,
    surfaceGravityG: 0.138,
    escapeVelocityKms: 2.639,
    solarDay: '15.945 Earth days',
    siderealPeriod: '15.945 days (tidally locked to Saturn)',
    orbitalPeriod: '15.945 days around Saturn',
    distanceFromPrimary: '1,221,870 km from Saturn',
    eccentricity: 0.0288,
    inclinationDeg: 0.348,
    axialTiltDeg: 0.0,
    surfaceTempMinC: -182.0,
    surfaceTempMeanC: -179.5,
    surfaceTempMaxC: -176.0,
    surfacePressure: '1,467 hPa (1.45 atm — 50% higher than Earth)',
    atmosphere: ['94.2% Nitrogen (N₂)', '5.65% Methane (CH₄)', 'Trace Hydrogen (H₂)'],
    features: ['Active methane/ethane hydrological cycle with methane rain and rivers', 'Vast northern hydrocarbon seas (Kraken Mare, Ligeia Mare)', 'Equatorial organic sand dune fields (Shangri-La)', 'Deep subsurface liquid water-ammonia ocean'],
    geologySummary: 'Water ice bedrock behaves like granite at 94 Kelvin. Liquid methane carves canyons and river valleys emptying into hydrocarbon lakes.'
  },
  europa: {
    id: 'europa', name: 'Europa', category: 'Moon of Jupiter',
    tagline: 'A smooth shell of water ice covering a vast global saltwater ocean holding twice Earth’s water.',
    radiusKm: 1560.8,
    massKg: '4.800 × 10²² kg',
    massEarth: '0.008 M⊕',
    surfaceGravityMs2: 1.315,
    surfaceGravityG: 0.134,
    escapeVelocityKms: 2.025,
    solarDay: '3.551 Earth days',
    siderealPeriod: '3.551 days (tidally locked to Jupiter)',
    orbitalPeriod: '3.551 days around Jupiter (Laplace resonance)',
    distanceFromPrimary: '670,900 km from Jupiter',
    eccentricity: 0.0090,
    inclinationDeg: 0.470,
    axialTiltDeg: 0.1,
    surfaceTempMinC: -223.0,
    surfaceTempMeanC: -171.0,
    surfaceTempMaxC: -140.0,
    surfacePressure: '1 × 10⁻¹² bar (tenuous O₂ exosphere)',
    atmosphere: ['Radiolytic Oxygen (O₂) produced by Jupiter radiation belt impacts on ice'],
    features: ['Global subsurface ocean 60–150 km deep', 'Criss-crossing reddish lineae and cycloidal cracks', 'Conamara Chaos rafted ice terrain', 'Tidal flexing heating by Jupiter gravitational resonance with Io and Ganymede'],
    geologySummary: 'Brittle ice shell 15–25 km thick floating on a 100 km deep liquid ocean resting on a rocky silicate mantle and metallic core.'
  },
  pluto: {
    id: 'pluto', name: 'Pluto', category: 'Dwarf Planet / Kuiper Belt',
    tagline: 'A complex, geologically young world of nitrogen glaciers, methane mountains, and blue hazes.',
    radiusKm: 1188.3,
    massKg: '1.303 × 10²² kg',
    massEarth: '0.00218 M⊕',
    surfaceGravityMs2: 0.620,
    surfaceGravityG: 0.063,
    escapeVelocityKms: 1.212,
    solarDay: '6.387 Earth days',
    siderealPeriod: '6.387 days (retrograde, mutually locked with Charon)',
    orbitalPeriod: '247.94 years',
    distanceFromPrimary: '39.482 AU (5.9 billion km)',
    eccentricity: 0.2488,
    inclinationDeg: 17.16,
    axialTiltDeg: 122.53,
    surfaceTempMinC: -240.0,
    surfaceTempMeanC: -229.0,
    surfaceTempMaxC: -218.0,
    surfacePressure: '1.0 Pa (~10 microbars)',
    atmosphere: ['99% Nitrogen (N₂)', '0.5% Methane (CH₄)', '0.05% Carbon monoxide (CO)'],
    features: ['Sputnik Planitia (1,000 km nitrogen-ice glacier heart)', 'Water-ice mountains (Tenzing & Hillary Montes) rising 3.5 km', 'Mutually tidally locked binary planetary system with Charon', 'Multi-layered blue atmospheric hydrocarbon haze'],
    geologySummary: 'Convecting cellular nitrogen ice glaciers overturn every 500,000 years. Subsurface liquid water ocean insulated by gas hydrates likely persists today.'
  },
  enceladus: {
    id: 'enceladus', name: 'Enceladus', category: 'Moon of Saturn',
    tagline: 'Saturn’s snow-white jewel erupting hydrothermal geysers of water vapor and organics into space.',
    radiusKm: 252.1,
    massKg: '1.080 × 10²⁰ kg',
    massEarth: '0.000018 M⊕',
    surfaceGravityMs2: 0.113,
    surfaceGravityG: 0.011,
    escapeVelocityKms: 0.239,
    solarDay: '1.370 Earth days',
    siderealPeriod: '1.370 days (tidally locked to Saturn)',
    orbitalPeriod: '1.370 days around Saturn',
    distanceFromPrimary: '238,000 km from Saturn (inside E Ring)',
    eccentricity: 0.0047,
    inclinationDeg: 0.009,
    axialTiltDeg: 0.0,
    surfaceTempMinC: -240.0,
    surfaceTempMeanC: -198.0,
    surfaceTempMaxC: -75.0,
    surfacePressure: 'Trace exosphere from volcanic venting',
    atmosphere: ['91% Water vapor', '4% Nitrogen', '3.2% Carbon dioxide', '1.7% Methane'],
    features: ['Over 100 cryovolcanic geysers erupting from south polar Tiger Stripes', 'Eruptions generate Saturn’s diffuse E Ring', 'Subsurface global ocean with alkaline pH and hydrothermal silica nanoparticles', 'Highest albedo of any celestial body in Sol (reflects 99% of sunlight)'],
    geologySummary: 'South polar crust thinned to 5 km over active hydrothermal vents on an alkaline, porous rocky core.'
  }
};

export function getDossier(id: string): WorldDossier | null {
  return DOSSIERS[id.toLowerCase()] ?? null;
}
