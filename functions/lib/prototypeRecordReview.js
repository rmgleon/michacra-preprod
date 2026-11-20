export function prototypeReviewFlags(record) {
    const flags = [];
    if (record.surfaceHa === 10 || record.surfaceHa === 5)
        flags.push(`former-default-surface:${record.surfaceHa}`);
    if (record.lat === -27.4862 && record.lng === -55.1205)
        flags.push('former-default-map-coordinates');
    if (record.tenureType === 'propiedad_con_titulo' && !record.locationCapturedAt && !record.locationCapturedBy)
        flags.push('default-tenure-without-capture-metadata');
    if (record.locationCapturedAt && record.locationCapturedBy && record.locationMethod === 'not_georeferenced')
        flags.push('capture-metadata-without-coordinates');
    return flags;
}
