const BAKERY_TIME_ZONE = 'America/New_York';

function bakeryToday(now = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: BAKERY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function minimumPickupDate(now = new Date()) {
  const [year, month, day] = bakeryToday(now).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 3)).toISOString().slice(0, 10);
}

function isValidPickupDate(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.toISOString().slice(0, 10) === value && value >= minimumPickupDate(now);
}

export { minimumPickupDate, isValidPickupDate };
