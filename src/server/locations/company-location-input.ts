export type CompanyLocationType = 'headquarters' | 'branch' | 'warehouse' | 'remote_site' | 'other';

export type CompanyLocationInput = {
  name?: string;
  locationType?: CompanyLocationType;
  address?: string;
  lat?: number | string;
  lng?: number | string;
  latitude?: number | string;
  longitude?: number | string;
  radius?: number | string;
  isPrimary?: boolean;
  isActive?: boolean;
};

export type NormalizedCompanyLocation = {
  name: string;
  locationType: CompanyLocationType;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isPrimary: boolean;
  isActive: boolean;
};

const companyLocationTypes: CompanyLocationType[] = [
  'headquarters',
  'branch',
  'warehouse',
  'remote_site',
  'other',
];

function isCompanyLocationType(value: unknown): value is CompanyLocationType {
  return typeof value === 'string' && companyLocationTypes.includes(value as CompanyLocationType);
}

export function normalizeCompanyLocations(
  locations: CompanyLocationInput[] | undefined,
  fallbackLocation?: CompanyLocationInput,
) {
  const rawLocations = Array.isArray(locations) && locations.length > 0
    ? locations
    : fallbackLocation?.lat !== undefined || fallbackLocation?.lng !== undefined || fallbackLocation?.latitude !== undefined || fallbackLocation?.longitude !== undefined || fallbackLocation?.radius !== undefined
      ? [{ ...fallbackLocation, name: fallbackLocation.name || 'Headquarters', locationType: 'headquarters' as const, isPrimary: true }]
      : [];

  if (rawLocations.length === 0) {
    return { ok: false as const, error: 'At least one company location is required.' };
  }

  const primaryIndex = rawLocations.findIndex((location) => location.isPrimary);

  for (const [index, location] of rawLocations.entries()) {
    const name = location.name?.trim() || '';
    const locationType = location.locationType || (index === 0 ? 'headquarters' : 'branch');
    const latitude = Number(location.lat ?? location.latitude);
    const longitude = Number(location.lng ?? location.longitude);
    const radiusMeters = Number(location.radius);

    if (!name) return { ok: false as const, error: 'Each location requires a name.' };
    if (name.length > 120 || (location.address && location.address.trim().length > 300)) {
      return { ok: false as const, error: 'Location names must be 120 characters or fewer and addresses 300 characters or fewer.' };
    }
    if (!isCompanyLocationType(locationType)) {
      return { ok: false as const, error: 'locationType must be headquarters, branch, warehouse, remote_site, or other.' };
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { ok: false as const, error: 'Each location requires valid lat and lng numbers.' };
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return { ok: false as const, error: 'Each location latitude must be -90 to 90 and longitude must be -180 to 180.' };
    }
    if (!Number.isFinite(radiusMeters) || radiusMeters < 25 || radiusMeters > 5000) {
      return { ok: false as const, error: 'Each location radius must be between 25 and 5000 meters.' };
    }
  }

  const normalizedLocations: NormalizedCompanyLocation[] = rawLocations.map((location, index) => ({
    name: location.name!.trim().slice(0, 120),
    locationType: location.locationType || (index === 0 ? 'headquarters' : 'branch'),
    address: location.address?.trim().slice(0, 300) || null,
    latitude: Number(location.lat ?? location.latitude),
    longitude: Number(location.lng ?? location.longitude),
    radiusMeters: Number(location.radius),
    isPrimary: primaryIndex === -1 ? index === 0 : index === primaryIndex,
    isActive: location.isActive ?? true,
  }));

  return { ok: true as const, locations: normalizedLocations };
}
