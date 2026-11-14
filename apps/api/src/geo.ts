export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface Place {
  country: string;
  label: string;
}

const cache = new Map<string, { place: Place; at: number }>();
const DAY = 24 * 60 * 60 * 1000;
let lastCall = 0;

export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

export function fixOf(input: Record<string, unknown>): Fix | null {
  if (input.lat === undefined || input.lat === null || input.lng === undefined || input.lng === null) return null;
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const accuracy = Math.round(Number(input.accuracy ?? 0));
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng, accuracy: Number.isFinite(accuracy) && accuracy > 0 ? Math.min(accuracy, 100000) : 0 };
}

export async function placeOf(fix: Fix): Promise<Place | null> {
  const key = fix.lat.toFixed(3) + ',' + fix.lng.toFixed(3);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.place;
  const base = (process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();
  try {
    const response = await fetch(`${base}/reverse?format=jsonv2&zoom=14&addressdetails=1&lat=${fix.lat}&lon=${fix.lng}`, {
      headers: { 'user-agent': 'Altamid-HRMS/1.0 (attendance check-in)', 'accept-language': 'en' },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { address?: Record<string, string> };
    const address = body.address || {};
    const country = String(address.country_code || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return null;
    const town = address.suburb || address.neighbourhood || address.city_district || '';
    const city = address.city || address.town || address.village || address.county || '';
    const label = [town, city, address.state].filter(Boolean).filter((part, index, all) => all.indexOf(part) === index).slice(0, 3).join(', ');
    const place = { country, label: label || address.country || country };
    if (cache.size > 5000) cache.clear();
    cache.set(key, { place, at: Date.now() });
    return place;
  } catch {
    return null;
  }
}
