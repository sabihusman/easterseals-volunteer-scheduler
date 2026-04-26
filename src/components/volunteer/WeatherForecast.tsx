import { useEffect, useState } from "react";
import { Cloud, Sun, CloudRain, CloudSnow, CloudLightning, CloudFog, CloudSun, CloudDrizzle } from "lucide-react";

interface WeatherData {
  high: number;
  low: number;
  condition: string;
  precipitation: number;
  wind: number;
  icon: React.ReactNode;
}

const WMO_MAP: Record<number, { label: string; icon: "sun" | "partlyCloudy" | "fog" | "rain" | "snow" | "showers" | "thunder" }> = {
  0: { label: "Clear Sky", icon: "sun" },
  1: { label: "Partly Cloudy", icon: "partlyCloudy" },
  2: { label: "Partly Cloudy", icon: "partlyCloudy" },
  3: { label: "Overcast", icon: "partlyCloudy" },
  45: { label: "Foggy", icon: "fog" },
  48: { label: "Foggy", icon: "fog" },
  51: { label: "Light Drizzle", icon: "rain" },
  53: { label: "Drizzle", icon: "rain" },
  55: { label: "Heavy Drizzle", icon: "rain" },
  61: { label: "Light Rain", icon: "rain" },
  63: { label: "Rain", icon: "rain" },
  65: { label: "Heavy Rain", icon: "rain" },
  71: { label: "Light Snow", icon: "snow" },
  73: { label: "Snow", icon: "snow" },
  75: { label: "Heavy Snow", icon: "snow" },
  77: { label: "Snow Grains", icon: "snow" },
  80: { label: "Light Showers", icon: "showers" },
  81: { label: "Showers", icon: "showers" },
  82: { label: "Heavy Showers", icon: "showers" },
  95: { label: "Thunderstorm", icon: "thunder" },
  96: { label: "Thunderstorm w/ Hail", icon: "thunder" },
  99: { label: "Severe Thunderstorm", icon: "thunder" },
};

const ICON_MAP = {
  sun: <Sun className="h-8 w-8 text-amber-500" />,
  partlyCloudy: <CloudSun className="h-8 w-8 text-blue-400" />,
  fog: <CloudFog className="h-8 w-8 text-gray-400" />,
  rain: <CloudRain className="h-8 w-8 text-blue-500" />,
  snow: <CloudSnow className="h-8 w-8 text-sky-300" />,
  showers: <CloudDrizzle className="h-8 w-8 text-blue-400" />,
  thunder: <CloudLightning className="h-8 w-8 text-yellow-500" />,
};

interface WeatherForecastProps {
  shiftDate: string; // yyyy-MM-dd
}

export function WeatherForecast({ shiftDate }: WeatherForecastProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=41.6731&longitude=-93.7196&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,windspeed_10m_max&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=America%2FChicago&forecast_days=16";

    fetch(url)
      .then(r => r.json())
      .then(data => {
        const idx = data.daily?.time?.indexOf(shiftDate);
        if (idx === undefined || idx === -1) {
          setUnavailable(true);
          return;
        }
        const code = data.daily.weathercode[idx];
        const wmo = WMO_MAP[code] || { label: "Unknown", icon: "partlyCloudy" };
        setWeather({
          high: Math.round(data.daily.temperature_2m_max[idx]),
          low: Math.round(data.daily.temperature_2m_min[idx]),
          condition: wmo.label,
          precipitation: data.daily.precipitation_probability_max[idx],
          wind: Math.round(data.daily.windspeed_10m_max[idx]),
          icon: ICON_MAP[wmo.icon],
        });
      })
      .catch(() => {
        // Silently fail — don't show weather
      });
  }, [shiftDate]);

  if (unavailable) {
    return (
      <div className="rounded-md border border-border bg-surface p-3 text-sm text-muted-foreground">
        Weather forecast not yet available for this date. Check back closer to the shift.
      </div>
    );
  }

  if (!weather) return null;

  return (
    <div className="rounded-md border border-border bg-surface p-3 space-y-2">
      <div className="flex items-center gap-3">
        {weather.icon}
        <div>
          <div className="font-medium text-sm">{weather.condition}</div>
          <div className="text-xs text-muted-foreground">
            High {weather.high}°F · Low {weather.low}°F
          </div>
        </div>
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>💧 {weather.precipitation}% precip</span>
        <span>💨 {weather.wind} mph wind</span>
      </div>
      <div className="text-[10px] text-muted-foreground italic">Weather shown for Johnston, Iowa</div>
    </div>
  );
}
