/**
 * Planetary Carrier Complex (K_t) Engine
 * Manages 14 real-world global data center hubs, fiber propagation matrix,
 * geodesic math, and topological graph complexes.
 */

import { HubNode, FiberLink, CarrierComplexG } from '../types/hrm';

export const SPEED_OF_LIGHT_IN_FIBER_KM_MS = 200.0; // ~200 km/ms = 200,000 km/s (refractive index n ≈ 1.48)
export const EARTH_RADIUS_KM = 6371.0;
export const SIGMA_DISTANCE_KM = 7000.0;

export const PLANETARY_HUBS: HubNode[] = [
  {
    id: 'ashburn',
    code: 'IAD',
    name: 'Ashburn (Data Center Alley)',
    lat: 39.0438,
    lng: -77.4874,
    country: 'United States',
    region: 'Americas',
    pueBaseline: 1.15,
    coolingCapacityMw: 450,
    solarExposureCoeff: 0.85,
  },
  {
    id: 'dublin',
    code: 'DUB',
    name: 'Dublin (Grange Castle)',
    lat: 53.3498,
    lng: -6.2603,
    country: 'Ireland',
    region: 'Europe',
    pueBaseline: 1.18,
    coolingCapacityMw: 320,
    solarExposureCoeff: 0.65,
  },
  {
    id: 'frankfurt',
    code: 'FRA',
    name: 'Frankfurt (DE-CIX Core)',
    lat: 50.1109,
    lng: 8.6821,
    country: 'Germany',
    region: 'Europe',
    pueBaseline: 1.22,
    coolingCapacityMw: 380,
    solarExposureCoeff: 0.70,
  },
  {
    id: 'london',
    code: 'LON',
    name: 'London (Slough/Docklands)',
    lat: 51.5074,
    lng: -0.1278,
    country: 'United Kingdom',
    region: 'Europe',
    pueBaseline: 1.20,
    coolingCapacityMw: 350,
    solarExposureCoeff: 0.68,
  },
  {
    id: 'oregon',
    code: 'PDX',
    name: 'Oregon (The Dalles Hydro)',
    lat: 45.5946,
    lng: -121.1787,
    country: 'United States',
    region: 'Americas',
    pueBaseline: 1.10,
    coolingCapacityMw: 500,
    solarExposureCoeff: 0.80,
  },
  {
    id: 'tokyo',
    code: 'NRT',
    name: 'Tokyo (Inzai / Otemachi)',
    lat: 35.6762,
    lng: 139.6503,
    country: 'Japan',
    region: 'APAC',
    pueBaseline: 1.26,
    coolingCapacityMw: 360,
    solarExposureCoeff: 0.90,
  },
  {
    id: 'singapore',
    code: 'SIN',
    name: 'Singapore (Jurong Confluence)',
    lat: 1.3521,
    lng: 103.8198,
    country: 'Singapore',
    region: 'APAC',
    pueBaseline: 1.32,
    coolingCapacityMw: 280,
    solarExposureCoeff: 0.95,
  },
  {
    id: 'mumbai',
    code: 'BOM',
    name: 'Mumbai (BKC / Navi Mumbai)',
    lat: 19.0760,
    lng: 72.8777,
    country: 'India',
    region: 'APAC',
    pueBaseline: 1.35,
    coolingCapacityMw: 310,
    solarExposureCoeff: 0.95,
  },
  {
    id: 'dubai',
    code: 'DXB',
    name: 'Dubai (UAE Exchange Hub)',
    lat: 25.2048,
    lng: 55.2708,
    country: 'United Arab Emirates',
    region: 'Middle East',
    pueBaseline: 1.38,
    coolingCapacityMw: 240,
    solarExposureCoeff: 1.0,
  },
  {
    id: 'marseille',
    code: 'MRS',
    name: 'Marseille (MRS Subsea Landing)',
    lat: 43.2965,
    lng: 5.3698,
    country: 'France',
    region: 'Europe',
    pueBaseline: 1.21,
    coolingCapacityMw: 260,
    solarExposureCoeff: 0.82,
  },
  {
    id: 'saopaulo',
    code: 'GRU',
    name: 'São Paulo (Tamboré / Barueri)',
    lat: -23.5505,
    lng: -46.6333,
    country: 'Brazil',
    region: 'Americas',
    pueBaseline: 1.28,
    coolingCapacityMw: 290,
    solarExposureCoeff: 0.88,
  },
  {
    id: 'santiago',
    code: 'SCL',
    name: 'Santiago (Quilicura Hub)',
    lat: -33.4489,
    lng: -70.6693,
    country: 'Chile',
    region: 'Americas',
    pueBaseline: 1.24,
    coolingCapacityMw: 210,
    solarExposureCoeff: 0.92,
  },
  {
    id: 'johannesburg',
    code: 'JNB',
    name: 'Johannesburg (Isando)',
    lat: -26.2041,
    lng: 28.0473,
    country: 'South Africa',
    region: 'Africa',
    pueBaseline: 1.30,
    coolingCapacityMw: 220,
    solarExposureCoeff: 0.90,
  },
  {
    id: 'sydney',
    code: 'SYD',
    name: 'Sydney (Alexandria / Botany)',
    lat: -33.8688,
    lng: 151.2093,
    country: 'Australia',
    region: 'APAC',
    pueBaseline: 1.25,
    coolingCapacityMw: 300,
    solarExposureCoeff: 0.90,
  },
];

/**
 * Great-circle distance using Haversine formula
 */
export function computeGeodesicDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

export function computeFiberLatencyMs(distanceKm: number): number {
  // Speed of light in single mode fiber ~ 200 km / ms
  return Number((distanceKm / SPEED_OF_LIGHT_IN_FIBER_KM_MS).toFixed(2));
}

// Major Subsea Cable & Terrestrial Backbone Trunks
interface LinkSpec {
  id: string;
  sourceId: string;
  targetId: string;
  name: string;
  type: 'submarine' | 'terrestrial';
  capacityTbps: number;
}

const FIBER_TOPOLOGY_SPECS: LinkSpec[] = [
  // Transatlantic
  { id: 'tat_ash_dub', sourceId: 'ashburn', targetId: 'dublin', name: 'Dunant / AEC-1 Subsea', type: 'submarine', capacityTbps: 250 },
  { id: 'tat_ash_lon', sourceId: 'ashburn', targetId: 'london', name: 'Apollo North Subsea', type: 'submarine', capacityTbps: 220 },
  // Europe Terrestrial & Cross-Channel
  { id: 'eur_dub_lon', sourceId: 'dublin', targetId: 'london', name: 'Irish Sea Express', type: 'submarine', capacityTbps: 180 },
  { id: 'eur_lon_fra', sourceId: 'london', targetId: 'frankfurt', name: 'Channel Tunnel Terrestrial', type: 'terrestrial', capacityTbps: 320 },
  { id: 'eur_fra_mrs', sourceId: 'frankfurt', targetId: 'marseille', name: 'Rhône Valley Terrestrial', type: 'terrestrial', capacityTbps: 280 },
  // Transpacific & US Transcontinental
  { id: 'usa_ash_pdx', sourceId: 'ashburn', targetId: 'oregon', name: 'US Transcontinental Express', type: 'terrestrial', capacityTbps: 400 },
  { id: 'pac_pdx_nrt', sourceId: 'oregon', targetId: 'tokyo', name: 'FASTER Transpacific Subsea', type: 'submarine', capacityTbps: 260 },
  { id: 'pac_nrt_sin', sourceId: 'tokyo', targetId: 'singapore', name: 'SJC2 South-East Asia Subsea', type: 'submarine', capacityTbps: 240 },
  // Mediterranean & Middle East Subsea (Suez route)
  { id: 'med_mrs_dxb', sourceId: 'marseille', targetId: 'dubai', name: 'AAE-1 Med-Gulf Subsea', type: 'submarine', capacityTbps: 200 },
  { id: 'gulf_dxb_bom', sourceId: 'dubai', targetId: 'mumbai', name: 'MENA / Falcon Subsea', type: 'submarine', capacityTbps: 190 },
  { id: 'ind_bom_sin', sourceId: 'mumbai', targetId: 'singapore', name: 'i2i / SEA-ME-WE-5 Subsea', type: 'submarine', capacityTbps: 210 },
  // Southern Cross & Oceania
  { id: 'pac_sin_syd', sourceId: 'singapore', targetId: 'sydney', name: 'Indigo Central Subsea', type: 'submarine', capacityTbps: 160 },
  { id: 'pac_pdx_syd', sourceId: 'oregon', targetId: 'sydney', name: 'Southern Cross NEXT Subsea', type: 'submarine', capacityTbps: 180 },
  // Latin America Backbone
  { id: 'lat_ash_gru', sourceId: 'ashburn', targetId: 'saopaulo', name: 'Seabras-1 / Monet Subsea', type: 'submarine', capacityTbps: 170 },
  { id: 'lat_gru_scl', sourceId: 'saopaulo', targetId: 'santiago', name: 'Andes Terrestrial Crossing', type: 'terrestrial', capacityTbps: 150 },
  { id: 'lat_pdx_scl', sourceId: 'oregon', targetId: 'santiago', name: 'Curie Pacific Subsea', type: 'submarine', capacityTbps: 160 },
  // Africa Trunks
  { id: 'afr_lon_jnb', sourceId: 'london', targetId: 'johannesburg', name: '2Africa / WACS Subsea', type: 'submarine', capacityTbps: 140 },
  { id: 'afr_jnb_bom', sourceId: 'johannesburg', targetId: 'mumbai', name: 'SAFE Indian Ocean Subsea', type: 'submarine', capacityTbps: 130 },
  // Inter-hub mesh bridges
  { id: 'eur_fra_dub', sourceId: 'frankfurt', targetId: 'dublin', name: 'North Sea Ring', type: 'terrestrial', capacityTbps: 200 },
  { id: 'pac_nrt_syd', sourceId: 'tokyo', targetId: 'sydney', name: 'Japan-Guam-Australia Subsea', type: 'submarine', capacityTbps: 170 },
];

export function buildInitialCarrierComplex(): CarrierComplexG {
  const nodes = [...PLANETARY_HUBS];
  const N = nodes.length;

  const nodeIndexMap = new Map<string, number>();
  nodes.forEach((node, idx) => nodeIndexMap.set(node.id, idx));

  // Compute N x N distance and propagation matrices
  const distanceMatrix: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  const propagationLatency: number[][] = Array.from({ length: N }, () => Array(N).fill(0));

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i === j) {
        distanceMatrix[i][j] = 0;
        propagationLatency[i][j] = 0;
      } else {
        const d = computeGeodesicDistanceKm(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng);
        distanceMatrix[i][j] = d;
        propagationLatency[i][j] = computeFiberLatencyMs(d);
      }
    }
  }

  // Build Links with verified geodesic lengths
  const links: FiberLink[] = FIBER_TOPOLOGY_SPECS.map(spec => {
    const sIdx = nodeIndexMap.get(spec.sourceId);
    const tIdx = nodeIndexMap.get(spec.targetId);
    const dist = sIdx !== undefined && tIdx !== undefined ? distanceMatrix[sIdx][tIdx] : 5000;
    const latency = computeFiberLatencyMs(dist);
    const weight = spec.capacityTbps * Math.exp(-(dist * dist) / (2 * SIGMA_DISTANCE_KM * SIGMA_DISTANCE_KM));

    return {
      id: spec.id,
      sourceId: spec.sourceId,
      targetId: spec.targetId,
      name: spec.name,
      type: spec.type,
      lengthKm: Math.round(dist),
      latencyMs: latency,
      capacityTbps: spec.capacityTbps,
      weight,
      isSevered: false,
      health: 1.0,
    };
  });

  const { adjacency, laplacian } = recalculateMatrices(nodes, links);

  return {
    nodes,
    links,
    adjacency,
    laplacian,
    distanceMatrix,
    propagationLatency,
  };
}

export function recalculateMatrices(nodes: HubNode[], links: FiberLink[]) {
  const N = nodes.length;
  const nodeIndexMap = new Map<string, number>();
  nodes.forEach((node, idx) => nodeIndexMap.set(node.id, idx));

  const adjacency: number[][] = Array.from({ length: N }, () => Array(N).fill(0));

  links.forEach(link => {
    if (link.isSevered || link.health <= 0.05) return;
    const i = nodeIndexMap.get(link.sourceId);
    const j = nodeIndexMap.get(link.targetId);
    if (i !== undefined && j !== undefined) {
      const effectiveWeight = link.weight * link.health;
      adjacency[i][j] = effectiveWeight;
      adjacency[j][i] = effectiveWeight;
    }
  });

  // Degree-Normalized Graph Laplacian: L_rw = I - D^{-1} W
  // Ensures maximum eigenvalue <= 2 and physical diffusion stability
  const laplacian: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    let degree = 0;
    for (let j = 0; j < N; j++) {
      if (i !== j) {
        degree += adjacency[i][j];
      }
    }

    if (degree > 1e-6) {
      laplacian[i][i] = 1.0;
      for (let j = 0; j < N; j++) {
        if (i !== j && adjacency[i][j] > 0) {
          laplacian[i][j] = -adjacency[i][j] / degree;
        }
      }
    } else {
      laplacian[i][i] = 0.0;
    }
  }

  return { adjacency, laplacian };
}

/**
 * Calculates diurnal follow-the-sun local solar intensity [0.0, 1.0]
 * at given global UTC time (hours) for a node given its longitude.
 */
export function computeLocalSolarIntensity(utcHours: number, lng: number): number {
  // Local solar time in hours:
  const localSolarTime = (utcHours + lng / 15.0 + 24.0) % 24.0;
  // Peak at 12:00 (solar noon), zero during night (roughly 18:00 to 06:00)
  if (localSolarTime >= 6.0 && localSolarTime <= 18.0) {
    const angle = ((localSolarTime - 6.0) / 12.0) * Math.PI;
    return Math.sin(angle);
  }
  return 0.02; // baseline diffuse nighttime ambient / moonlight
}
