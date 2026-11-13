import * as Location from 'expo-location';
import gaugesRaw from '../data/gauges.json';

/**
 * "Your spot": how high the phone's location sits above the lowest ground
 * around it, from the USGS 3DEP elevation service (1 m lidar in most of Texas).
 *
 * Floodwater fills the lowest ground first (creeks, ditches, streets), so the
 * replay starts the river's rise from that low point. Height above nearby low
 * ground is a common stand-in for flood exposure (like "height above nearest
 * drainage"); it is not a flood map for the address.
 */

export type SpotResult = {
  lat: number;
  lon: number;
  elevationFt: number;
  lowestFt: number;
  aboveLowFt: number;
  lowestDistanceM: number;
  sampled: number;
  nearestGauge: { id: string; name: string; km: number };
};

const EPQS = 'https://epqs.nationalmap.gov/v1/json';
const RADII_M = [300, 1000];
const BEARINGS = 8;

type Gauge = { name: string; lat: number; lon: number };
const gauges = gaugesRaw as unknown as Record<string, Gauge>;

function kmBetween(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function elevationFt(lat: number, lon: number, signal?: AbortSignal): Promise<number | null> {
  try {
    const r = await fetch(`${EPQS}?x=${lon.toFixed(6)}&y=${lat.toFixed(6)}&units=Feet&wkid=4326&includeDate=false`, { signal });
    const text = await r.text();
    const v = Number(JSON.parse(text)?.value);
    return Number.isFinite(v) && v > -1000 ? v : null; // outside coverage returns an error or -1000000
  } catch {
    return null;
  }
}

export async function locateMySpot(onStep?: (msg: string) => void): Promise<SpotResult> {
  onStep?.('Asking for your location…');
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) throw Error('Location permission is off. Allow it in Settings to use your spot.');

  onStep?.('Finding where you are…');
  const pos =
    (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 200 })) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  const { latitude: lat, longitude: lon } = pos.coords;

  onStep?.('Looking up ground elevation around you (USGS)…');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  const ring: { lat: number; lon: number; d: number }[] = [];
  for (const r of RADII_M) {
    for (let k = 0; k < BEARINGS; k++) {
      const a = (2 * Math.PI * k) / BEARINGS;
      ring.push({
        lat: lat + ((r * Math.cos(a)) / 111_320),
        lon: lon + ((r * Math.sin(a)) / (111_320 * Math.cos((lat * Math.PI) / 180))),
        d: r,
      });
    }
  }
  const [here, ...around] = await Promise.all([
    elevationFt(lat, lon, controller.signal),
    ...ring.map(p => elevationFt(p.lat, p.lon, controller.signal)),
  ]);
  clearTimeout(timer);
  if (here == null) throw Error('No USGS elevation data here. It covers the United States only.');

  let lowest = here;
  let lowestD = 0;
  around.forEach((v, i) => {
    if (v != null && v < lowest) {
      lowest = v;
      lowestD = ring[i].d;
    }
  });

  let nearest = { id: '', name: '', km: Infinity };
  for (const [id, g] of Object.entries(gauges)) {
    const km = kmBetween(lat, lon, g.lat, g.lon);
    if (km < nearest.km) nearest = { id, name: g.name, km };
  }

  return {
    lat,
    lon,
    elevationFt: here,
    lowestFt: lowest,
    aboveLowFt: Math.max(0, here - lowest),
    lowestDistanceM: lowestD,
    sampled: around.filter(v => v != null).length,
    nearestGauge: { ...nearest, km: Math.round(nearest.km) },
  };
}
