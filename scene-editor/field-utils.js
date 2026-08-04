// Shared field utilities used by device-fields.js and device-defaults.js.
// Centralises the validator accessor and enum option filtering so the
// selectEnums/exceptEnums logic lives in exactly one place.

export function validatorFor(field) {
  return (field.validatorParam && typeof field.validatorParam === 'object')
    ? field.validatorParam
    : {};
}

// Enum name aliases: some field unrealType values don't match the key in enums.json
// (e.g. the schema writes "ERecordScope" but the enum is stored as "EModStopwatchRecordScope").
const ENUM_ALIASES = {
  ERecordScope: 'EModStopwatchRecordScope',
};

// Returns the filtered + mapped enum option rows for a field.
// Each row: { value, label, englishLabel, key, rowName }
// englishLabel is the pre-translation label — used by selectedEnumHint to match
// description lines that are always written in English in the pak schema.
export function enumOptions(field, enums) {
  const v = validatorFor(field);
  const enumName = ENUM_ALIASES[field.unrealType] || field.unrealType;
  let rows = (enums?.[enumName] || []).map(r => ({
    value:        r.value,
    label:        r.label || r.value,
    englishLabel: r.englishLabel || r.label || r.value,
    key:          r.key,
    rowName:      r.rowName,
  }));
  if (Array.isArray(v.selectEnums) && v.selectEnums.length) {
    const sel = new Set(v.selectEnums);
    rows = rows.filter(r => sel.has(r.value));
  }
  if (Array.isArray(v.exceptEnums) && v.exceptEnums.length) {
    const exc = new Set(v.exceptEnums);
    rows = rows.filter(r => !exc.has(r.value));
  }
  return rows;
}
