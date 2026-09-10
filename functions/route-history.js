// v6.66.71 (Patrick 10.09.2026 08:05 Bridge: "wir haben die Daten von den Kurzfahrten,
// wie lange braucht man vom Bahnhof zur Reha-Klinik. Die kannst du doch verwenden bei
// der Routenberechnung. Du musst doch nicht immer alles starr machen.")
//
// Historic-Route-Cache: nutzt echte gemessene Fahrzeiten aus /rides + /ridesArchive
// statt Faustregel 1.5 × distKm. Bucketing auf 0.005° (~500m) für Robustheit gegen
// exakte Pickup-Punkt-Abweichungen.

const BUCKET_DEG = 0.005;
const HISTORY_MAX_DAYS = 60;
const MIN_SAMPLES_FOR_CACHE = 3;

let _cache = null;
let _cacheBuildAt = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 Min fresh, danach neu bauen

function bucketKey(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const bLat = Math.round(lat / BUCKET_DEG) * BUCKET_DEG;
    const bLon = Math.round(lon / BUCKET_DEG) * BUCKET_DEG;
    return bLat.toFixed(3) + ':' + bLon.toFixed(3);
}

function median(nums) {
    if (!nums.length) return null;
    const s = nums.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Baut den In-Memory-Cache aus /rides + /ridesArchive completed rides der letzten HISTORY_MAX_DAYS.
 * Cache-Struktur: Map<originBucket, Map<destBucket, [minutes...]>>.
 */
async function buildCache(db) {
    const cache = new Map();
    const now = Date.now();
    const minTs = now - HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000;

    const sources = ['rides', 'ridesArchive'];
    for (const src of sources) {
        try {
            const snap = await db.ref(src).once('value');
            const data = snap.val() || {};
            for (const rideId in data) {
                const r = data[rideId];
                if (!r || typeof r !== 'object') continue;
                if (r.status !== 'completed') continue;
                if (!r.onWayAt || !r.atDestinationAt) continue;
                if (r.completedAt && r.completedAt < minTs) continue;
                const _pLat = parseFloat(r.pickupLat || (r.pickupCoords && r.pickupCoords.lat));
                const _pLon = parseFloat(r.pickupLon || (r.pickupCoords && r.pickupCoords.lon));
                const _dLat = parseFloat(r.destinationLat || (r.destCoords && r.destCoords.lat));
                const _dLon = parseFloat(r.destinationLon || (r.destCoords && r.destCoords.lon));
                if (!Number.isFinite(_pLat) || !Number.isFinite(_pLon)) continue;
                if (!Number.isFinite(_dLat) || !Number.isFinite(_dLon)) continue;
                const oBucket = bucketKey(_pLat, _pLon);
                const dBucket = bucketKey(_dLat, _dLon);
                if (!oBucket || !dBucket) continue;
                const durMs = r.atDestinationAt - r.onWayAt;
                if (durMs < 30 * 1000 || durMs > 4 * 60 * 60 * 1000) continue; // 30s .. 4h Sanity
                const durMin = durMs / 60000;
                if (!cache.has(oBucket)) cache.set(oBucket, new Map());
                const inner = cache.get(oBucket);
                if (!inner.has(dBucket)) inner.set(dBucket, []);
                inner.get(dBucket).push(durMin);
            }
        } catch (e) {
            console.warn(`route-history buildCache ${src}:`, e && e.message);
        }
    }

    let totalRoutes = 0;
    for (const inner of cache.values()) totalRoutes += inner.size;
    console.log(`📊 v6.66.71 route-history-cache built: ${cache.size} origin-buckets, ${totalRoutes} routes`);
    return cache;
}

async function getCache(db) {
    const now = Date.now();
    if (_cache && (now - _cacheBuildAt) < CACHE_TTL_MS) return _cache;
    _cache = await buildCache(db);
    _cacheBuildAt = now;
    return _cache;
}

/**
 * Historisch gemessene Median-Fahrzeit für Route (Origin → Destination) in Minuten.
 * Fallback auf Faustregel-Estimate (haversine × 1.5) wenn keine History vorhanden.
 * Returns { minutes, source: 'history'|'estimate', samples }.
 */
async function getRouteTimeMinutes(db, oLat, oLon, dLat, dLon) {
    const cache = await getCache(db);
    const oBucket = bucketKey(oLat, oLon);
    const dBucket = bucketKey(dLat, dLon);
    if (oBucket && dBucket) {
        const inner = cache.get(oBucket);
        if (inner && inner.has(dBucket)) {
            const durs = inner.get(dBucket);
            if (durs.length >= MIN_SAMPLES_FOR_CACHE) {
                const med = median(durs);
                return { minutes: Math.ceil(med), source: 'history', samples: durs.length };
            }
        }
        // Fallback: gleicher Origin-Bucket, ähnlicher Dest-Bucket (±1 Grad-Step)
        if (inner) {
            const [dLatB, dLonB] = dBucket.split(':').map(parseFloat);
            const neighbors = [];
            for (let latOff = -1; latOff <= 1; latOff++) {
                for (let lonOff = -1; lonOff <= 1; lonOff++) {
                    if (latOff === 0 && lonOff === 0) continue;
                    const k = (dLatB + latOff * BUCKET_DEG).toFixed(3) + ':' + (dLonB + lonOff * BUCKET_DEG).toFixed(3);
                    if (inner.has(k)) neighbors.push(...inner.get(k));
                }
            }
            if (neighbors.length >= MIN_SAMPLES_FOR_CACHE) {
                const med = median(neighbors);
                return { minutes: Math.ceil(med), source: 'history-neighbor', samples: neighbors.length };
            }
        }
    }
    // Fallback: Faustregel haversine × 1.5
    const R = 6371;
    const lat1 = oLat * Math.PI / 180;
    const lat2 = dLat * Math.PI / 180;
    const dLatR = (dLat - oLat) * Math.PI / 180;
    const dLonR = (dLon - oLon) * Math.PI / 180;
    const a = Math.sin(dLatR / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLonR / 2) ** 2;
    const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return { minutes: Math.ceil(distKm * 1.5), source: 'estimate', samples: 0 };
}

module.exports = { getRouteTimeMinutes, bucketKey };
