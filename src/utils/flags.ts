export const countryCodeToFlag = (code: string): string => {
  if (!code) return '';
  const cc = code.trim().toUpperCase();
  const A = 0x1F1E6;
  return String.fromCodePoint(
    ...cc.split('').map(c => A + (c.charCodeAt(0) - 65))
  );
};

// Basic heuristic to derive a country flag emoji from a free-form location string.
export const getFlagEmojiForLocation = (location?: string): string | null => {
  if (!location) return null;
  const s = location.toLowerCase();

  // Nigeria detection by common states and aliases
  const nigeriaKeywords = [
    'nigeria','ng','lagos','abuja','fct','osun','oyo','kano','kaduna','enugu','akwa ibom',
    'rivers','plateau','benue','anambra','ogun','ondo','ekiti','kwara','kogi','imo','ebonyi',
    'edo','delta','cross river','taraba','adamawa','yobe','borno','gombe','bauchi','nasarawa',
    'sokoto','zamfara','kebbi','bayelsa','abia'
  ];
  if (nigeriaKeywords.some(k => s.includes(k))) return '🇳🇬';

  // Common country name -> ISO code map (expand as needed)
  const countries: Record<string, string> = {
    'united states': 'US', 'usa': 'US', 'us': 'US', 'america': 'US',
    'united kingdom': 'GB', 'uk': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB',
    'canada': 'CA',
    'india': 'IN', 'bharat': 'IN',
    'ghana': 'GH',
    'south africa': 'ZA',
    'kenya': 'KE',
    'germany': 'DE',
    'france': 'FR',
    'spain': 'ES',
    'italy': 'IT',
    'brazil': 'BR',
    'mexico': 'MX',
    'japan': 'JP',
    'china': 'CN',
    'russia': 'RU',
    'australia': 'AU',
    'new zealand': 'NZ',
    'turkey': 'TR',
    'united arab emirates': 'AE', 'uae': 'AE', 'dubai': 'AE', 'abu dhabi': 'AE',
    'saudi arabia': 'SA', 'riyadh': 'SA', 'jeddah': 'SA',
    'ireland': 'IE',
    'netherlands': 'NL', 'holland': 'NL',
    'sweden': 'SE',
    'norway': 'NO',
    'denmark': 'DK',
    'finland': 'FI',
    'switzerland': 'CH',
    'austria': 'AT',
    'portugal': 'PT',
    'poland': 'PL',
    'czech republic': 'CZ', 'czech': 'CZ',
    'hungary': 'HU',
    'romania': 'RO',
    'greece': 'GR',
    'egypt': 'EG',
    'morocco': 'MA',
    'algeria': 'DZ',
    'tunisia': 'TN',
    'ethiopia': 'ET',
    'tanzania': 'TZ',
    'uganda': 'UG',
    'cameroon': 'CM',
    "cote d'ivoire": 'CI', 'côte d’ivoire': 'CI', 'ivory coast': 'CI',
    'senegal': 'SN',
  };

  for (const key in countries) {
    if (s.includes(key)) return countryCodeToFlag(countries[key]);
  }

  return null;
};