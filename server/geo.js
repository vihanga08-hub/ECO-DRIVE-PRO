const rad = (d) => (d * Math.PI) / 180;
const haversine = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x)); // km
};
const routeLength = (start, stops) => stops.reduce((s, p, i) => s + haversine(i ? stops[i - 1] : start, p), 0);

// Nearest-neighbour construction, then 2-opt improvement (never worse than the input order's greedy start).
function optimizeRoute(start, stops) {
  const left = [...stops];
  let route = [], cur = start;
  while (left.length) {
    let best = 0;
    left.forEach((p, i) => { if (haversine(cur, p) < haversine(cur, left[best])) best = i; });
    cur = left.splice(best, 1)[0];
    route.push(cur);
  }
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const cand = [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)];
        if (routeLength(start, cand) < routeLength(start, route) - 1e-9) { route = cand; improved = true; }
      }
    }
  }
  return { route, km: routeLength(start, route), naiveKm: routeLength(start, stops) };
}
module.exports = { haversine, optimizeRoute, routeLength };
