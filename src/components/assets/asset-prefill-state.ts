export const assetIdentifierFields = ['serialNumber', 'model', 'manufacturer'] as const;

export type AssetIdentifierField = (typeof assetIdentifierFields)[number];
export type AssetFieldOrigin = 'untouched' | 'extraction-prefilled' | 'manually-edited' | 'manually-cleared';
export type AssetFieldOrigins = Record<AssetIdentifierField, AssetFieldOrigin>;

export function createAssetFieldOrigins(isEditing: boolean): AssetFieldOrigins {
  const origin: AssetFieldOrigin = isEditing ? 'manually-edited' : 'untouched';
  return {
    serialNumber: origin,
    model: origin,
    manufacturer: origin,
  };
}

export function originAfterManualChange(value: string): AssetFieldOrigin {
  return value.length === 0 ? 'manually-cleared' : 'manually-edited';
}

export function applyUntouchedAssetSuggestions<T extends Record<AssetIdentifierField, string>>(
  values: T,
  origins: AssetFieldOrigins,
  suggestions: Partial<Record<AssetIdentifierField, string>>,
): { values: T; origins: AssetFieldOrigins } {
  const nextValues = { ...values };
  const nextOrigins = { ...origins };

  for (const field of assetIdentifierFields) {
    const suggestion = suggestions[field];
    if (!suggestion || origins[field] !== 'untouched') continue;
    nextValues[field] = suggestion;
    nextOrigins[field] = 'extraction-prefilled';
  }

  return { values: nextValues, origins: nextOrigins };
}

export function canUseAssetLabelExtraction(permissions: readonly string[] | null | undefined): boolean {
  return Boolean(permissions?.includes('assets.manage') && permissions.includes('document_extraction.asset.manage'));
}
