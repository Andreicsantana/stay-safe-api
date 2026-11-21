const ACTIVE_STATUSES = ["pending", "notified", "acknowledged", "escalated"];

function buildMapsUrl(latitude, longitude) {
  if (latitude == null || longitude == null) return null;
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function formatAlert(row) {
  if (!row) return null;
  const latitude = row.latitude ?? null;
  const longitude = row.longitude ?? null;
  const createdAt = row.emitted_at ?? row.created_at ?? null;
  const dependentName = row.dependent_name ?? row.dependentName ?? null;

  return {
    id: row.id,
    status: row.status,
    emitted_at: row.emitted_at ?? createdAt,
    created_at: createdAt,
    acknowledged_at: row.acknowledged_at ?? null,
    resolved_at: row.resolved_at ?? null,
    escalated_at: row.escalated_at ?? null,
    dependent_profile_id: row.dependent_profile_id ?? null,
    dependent_name: dependentName,
    dependentName,
    notes: row.notes ?? null,
    address: row.address ?? null,
    latitude,
    longitude,
    mapsUrl: buildMapsUrl(latitude, longitude),
  };
}

module.exports = {
  ACTIVE_STATUSES,
  buildMapsUrl,
  formatAlert,
};
