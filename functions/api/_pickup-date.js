const BAKERY_TIME_ZONE = 'America/New_York';
const MINIMUM_LEAD_DAYS = 3;

function partsToDate(parts) {
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function bakeryToday(now = new Date()) {
  return partsToDate(new Intl.DateTimeFormat('en-US', {
    timeZone: BAKERY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now));
}

export function minimumPickupDate(now = new Date()) {
  const [year, month, day] = bakeryToday(now).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + MINIMUM_LEAD_DAYS))
    .toISOString()
    .slice(0, 10);
}

export function isValidPickupDate(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.toISOString().slice(0, 10) !== value) return false;
  return value >= minimumPickupDate(now);
}

export function validateCustomerDetails(details, now = new Date()) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    throw new Error('Customer details are required');
  }

  const customer_name = String(details.customer_name || '').trim();
  const customer_email = String(details.customer_email || '').trim();
  const customer_phone = String(details.customer_phone || '').trim();
  const acquisition_date = String(details.acquisition_date || '').trim();
  const acquisition_method = String(details.acquisition_method || 'pickup').trim();
  const delivery_address = String(details.delivery_address || '').trim();

  if (customer_name.length < 1 || customer_name.length > 120) {
    throw new Error('A valid customer name is required');
  }
  if (customer_email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
    throw new Error('A valid customer email is required');
  }
  const phoneDigits = customer_phone.replace(/\D/g, '');
  if (customer_phone.length > 40 || phoneDigits.length < 10 || phoneDigits.length > 15) {
    throw new Error('A valid customer phone number is required');
  }
  if (!['pickup', 'delivery'].includes(acquisition_method)) {
    throw new Error('A valid pickup or delivery method is required');
  }
  if (!isValidPickupDate(acquisition_date, now)) {
    throw new Error('The selected date must be at least three calendar days from today');
  }
  if (acquisition_method === 'delivery' && (delivery_address.length < 5 || delivery_address.length > 500)) {
    throw new Error('A valid delivery address is required');
  }

  return {
    customer_name,
    customer_email,
    customer_phone,
    acquisition_date,
    acquisition_method,
    delivery_address: acquisition_method === 'delivery' ? delivery_address : ''
  };
}
