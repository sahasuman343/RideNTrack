/**
 * Touring Intelligence & Motorcycle Profile Calculations
 * Pure functions supporting fuel planning, weather interpretation, and touring safety advisories.
 */

export interface MotorcycleProfile {
  make?: string | null;
  model?: string | null;
  fuelTankCapacityLiters?: number | null;
  mileageKmPerLiter?: number | null;
  fuelReserveLiters?: number | null;
  category?: 'adventure' | 'tourer' | 'cruiser' | 'sport' | 'commuter' | 'scooter' | null;
}

export interface MotorcycleFuelPlan {
  totalDistanceKm: number;
  totalTheoreticalRangeKm: number | null;
  safeRangeKm: number | null; // before reserve
  estimatedFuelConsumedLiters: number | null;
  recommendedFuelStops: number | null;
  estimatedCostInr: number | null; // based on typical fuel rate (105 INR/L)
  isAdvisory: true;
  advisoryNote: string;
}

export function calculateMotorcycleFuelPlan(
  distanceMeters: number,
  bike?: MotorcycleProfile | null,
  fuelPricePerLiter = 105
): MotorcycleFuelPlan {
  const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;
  const tank = bike?.fuelTankCapacityLiters ?? null;
  const mileage = bike?.mileageKmPerLiter ?? null;
  const reserve = bike?.fuelReserveLiters ?? 0;

  if (!tank || !mileage || tank <= 0 || mileage <= 0 || reserve < 0 || reserve >= tank) {
    return {
      totalDistanceKm: distanceKm,
      totalTheoreticalRangeKm: null,
      safeRangeKm: null,
      estimatedFuelConsumedLiters: null,
      recommendedFuelStops: null,
      estimatedCostInr: null,
      isAdvisory: true,
      advisoryNote: 'Check tank capacity, mileage and reserve in your motorcycle profile. Reserve must be less than tank capacity.',
    };
  }

  const usableCapacity = tank - reserve;
  const safeRangeKm = Math.round(usableCapacity * mileage);
  const totalTheoreticalRangeKm = Math.round(tank * mileage);
  const estimatedFuelConsumedLiters = Math.round((distanceKm / mileage) * 10) / 10;
  const recommendedFuelStops = safeRangeKm > 0 ? Math.max(0, Math.ceil(distanceKm / safeRangeKm) - 1) : 0;
  const estimatedCostInr = Math.round(estimatedFuelConsumedLiters * fuelPricePerLiter);

  return {
    totalDistanceKm: distanceKm,
    totalTheoreticalRangeKm,
    safeRangeKm,
    estimatedFuelConsumedLiters,
    recommendedFuelStops,
    estimatedCostInr,
    isAdvisory: true,
    advisoryNote: 'Advisory estimate based on ' + (bike?.model || 'your motorcycle') + ' (' + tank + 'L tank, ~' + mileage + ' km/l). Actual consumption varies with speed, terrain, elevation, and luggage.',
  };
}

export interface RouteWeatherPoint {
  label: string;
  latitude: number;
  longitude: number;
  temperatureC: number;
  humidityPercent: number;
  windSpeedKmh: number;
  weatherCode: number;
  condition: string;
  icon: string;
  retrievedAt: string;
  source: 'Open-Meteo API';
}

export function getWeatherConditionFromCode(code: number): { condition: string; icon: string; warning?: string } {
  if (code === 0) return { condition: 'Clear Sky', icon: '☀️' };
  if (code === 1) return { condition: 'Mainly Clear', icon: '🌤️' };
  if (code === 2) return { condition: 'Partly Cloudy', icon: '⛅' };
  if (code === 3) return { condition: 'Overcast', icon: '☁️' };
  if (code === 45 || code === 48) return { condition: 'Foggy / Low Visibility', icon: '🌫️', warning: 'Dense fog reduces visibility. Use low-beam fog lamps and ride with caution.' };
  if (code >= 51 && code <= 57) return { condition: 'Drizzle', icon: '🌦️', warning: 'Drizzle creates slick road surfaces. Increase braking distance.' };
  if (code >= 61 && code <= 67) return { condition: 'Rain', icon: '🌧️', warning: 'Wet roads: reduce cornering speeds, watch for oil slicks, and wear waterproof gear.' };
  if (code >= 71 && code <= 77) return { condition: 'Snow / Sleet', icon: '🌨️', warning: 'Freezing conditions: high risk of black ice.' };
  if (code >= 80 && code <= 82) return { condition: 'Heavy Showers', icon: '🌧️', warning: 'Heavy showers can cause waterlogging and aquaplaning.' };
  if (code >= 95) return { condition: 'Thunderstorm', icon: '⛈️', warning: 'High winds and lightning hazard: seek sheltered rest stop.' };
  return { condition: 'Fair', icon: '🌡️' };
}

export interface TouringSafetyAdvisory {
  type: 'fuel' | 'ghat' | 'weather' | 'night' | 'unverified';
  level: 'info' | 'caution' | 'warning';
  title: string;
  description: string;
}

export function generateTouringAdvisories(params: {
  distanceMeters: number;
  fuelPlan?: MotorcycleFuelPlan;
  weatherPoints?: RouteWeatherPoint[];
}): TouringSafetyAdvisory[] {
  const advisories: TouringSafetyAdvisory[] = [];

  // Fuel advisory
  if (params.fuelPlan && params.fuelPlan.safeRangeKm && params.fuelPlan.totalDistanceKm > params.fuelPlan.safeRangeKm) {
    advisories.push({
      type: 'fuel',
      level: 'caution',
      title: 'Fuel Stop Planning Required',
      description: 'Trip distance (' + params.fuelPlan.totalDistanceKm + ' km) exceeds your safe reserve range (' + params.fuelPlan.safeRangeKm + ' km). Plan at least ' + params.fuelPlan.recommendedFuelStops + ' fuel stop(s).',
    });
  }

  // Weather advisories
  if (params.weatherPoints) {
    for (const wp of params.weatherPoints) {
      const cond = getWeatherConditionFromCode(wp.weatherCode);
      if (cond.warning) {
        advisories.push({
          type: 'weather',
          level: wp.weatherCode >= 95 || wp.weatherCode >= 80 ? 'warning' : 'caution',
          title: cond.condition + ' at ' + wp.label,
          description: cond.warning + ' (' + wp.temperatureC + '°C, wind ' + wp.windSpeedKmh + ' km/h).',
        });
      }
    }
  }

  // Community observations disclaimer
  advisories.push({
    type: 'unverified',
    level: 'info',
    title: 'Advisory Information Notice',
    description: 'Fuel estimates and community stop notes are advisory estimates. Road conditions in touring terrains and mountain ghats can change rapidly.',
  });

  return advisories;
}

export interface PackRiderFuelInput {
  id: string;
  displayName: string;
  tankLiters?: number | null;
  mileageKmPerL?: number | null;
  reserveLiters?: number | null;
}

export interface PackFuelPlan {
  routeDistanceKm: number;
  limitingRider: { id: string; displayName: string; safeRangeKm: number } | null;
  fuelIntervalKm: number | null;
  recommendedFuelStops: number | null;
  ridersWithSpecs: number;
  ridersMissingSpecs: Array<{ id: string; displayName: string }>;
}

export function calculatePackFuelPlan(
  riders: PackRiderFuelInput[],
  routeDistanceKm: number,
): PackFuelPlan {
  const exactDistanceKm = Number.isFinite(routeDistanceKm) && routeDistanceKm > 0 ? routeDistanceKm : 0;
  const displayDistanceKm = Math.round(exactDistanceKm * 10) / 10;
  const ridersMissingSpecs: Array<{ id: string; displayName: string }> = [];
  let limitingRiderExact: { id: string; displayName: string; exactRangeKm: number } | null = null;
  let ridersWithSpecs = 0;

  for (const rider of riders) {
    const tank = rider.tankLiters ?? null;
    const mileage = rider.mileageKmPerL ?? null;
    const reserve = rider.reserveLiters ?? 0;

    if (!tank || !mileage || tank <= 0 || mileage <= 0 || reserve < 0 || reserve >= tank) {
      ridersMissingSpecs.push({ id: rider.id, displayName: rider.displayName });
      continue;
    }

    ridersWithSpecs++;
    const exactRangeKm = (tank - reserve) * mileage;
    if (exactRangeKm > 0 && (!limitingRiderExact || exactRangeKm < limitingRiderExact.exactRangeKm)) {
      limitingRiderExact = { id: rider.id, displayName: rider.displayName, exactRangeKm };
    }
  }

  const limitingRider = limitingRiderExact
    ? {
        id: limitingRiderExact.id,
        displayName: limitingRiderExact.displayName,
        safeRangeKm: Math.round(limitingRiderExact.exactRangeKm),
      }
    : null;
  const fuelIntervalKm = limitingRider ? limitingRider.safeRangeKm : null;
  const recommendedFuelStops =
    limitingRiderExact && limitingRiderExact.exactRangeKm > 0 && exactDistanceKm > 0
      ? Math.max(0, Math.ceil(exactDistanceKm / limitingRiderExact.exactRangeKm) - 1)
      : limitingRiderExact
        ? 0
        : null;

  return {
    routeDistanceKm: displayDistanceKm,
    limitingRider,
    fuelIntervalKm,
    recommendedFuelStops,
    ridersWithSpecs,
    ridersMissingSpecs,
  };
}

export type TerrainType = 'highway' | 'mixed' | 'ghat';

const TERRAIN_PACING_MULTIPLIERS: Record<TerrainType, number> = {
  highway: 1.1,
  mixed: 1.25,
  ghat: 1.45,
};

export function evaluateDaylightRisk(
  departureIso: string,
  estimatedDurationSeconds: number,
  sunsetIso: string,
  terrain: TerrainType = 'mixed',
): {
  risk: 'daylight' | 'night';
  multiplier: number;
  adjustedDurationSeconds: number;
  projectedArrivalIso: string | null;
  advisory: TouringSafetyAdvisory | null;
} {
  const multiplier = TERRAIN_PACING_MULTIPLIERS[terrain] ?? 1.25;
  const safeDuration = Number.isFinite(estimatedDurationSeconds) && estimatedDurationSeconds > 0 ? estimatedDurationSeconds : 0;
  const adjustedDurationSeconds = Math.round(safeDuration * multiplier);

  const depMs = Date.parse(departureIso);
  const sunsetMs = Date.parse(sunsetIso);
  if (!Number.isFinite(depMs) || !Number.isFinite(sunsetMs)) {
    return {
      risk: 'daylight',
      multiplier,
      adjustedDurationSeconds,
      projectedArrivalIso: null,
      advisory: null,
    };
  }

  const arrivalMs = depMs + adjustedDurationSeconds * 1000;
  const projectedArrivalIso = new Date(arrivalMs).toISOString();
  const isNightRisk = arrivalMs >= sunsetMs - 30 * 60 * 1000;

  return {
    risk: isNightRisk ? 'night' : 'daylight',
    multiplier,
    adjustedDurationSeconds,
    projectedArrivalIso,
    advisory: isNightRisk
      ? {
          type: 'night',
          level: 'warning',
          title: terrain === 'ghat' ? 'Ghat Night-Riding Risk' : 'Low-Light Arrival Warning',
          description: `With ${terrain} pacing (${multiplier}x), projected arrival (${projectedArrivalIso}) falls within 30 minutes of or after sunset. Consider an earlier departure or overnight halt.`,
        }
      : null,
  };
}
