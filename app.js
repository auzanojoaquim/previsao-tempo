// app.js - módulo principal
const geocodeBase = 'https://geocoding-api.open-meteo.com/v1/search';
const forecastBase = 'https://api.open-meteo.com/v1/forecast';

// DOM
const form = document.getElementById('searchForm');
const input = document.getElementById('cityInput');
const statusEl = document.getElementById('status');
const resultadoEl = document.getElementById('resultado');
const cityNameEl = document.getElementById('cityName');
const tempoLocalEl = document.getElementById('tempoLocal');
const tempoAtualEl = document.getElementById('tempoAtual');
const currentWeatherEl = document.getElementById('currentWeather');
const forecastListEl = document.getElementById('forecastList');

let currentController = null;

// Utilitários
function setStatus(txt){
  statusEl.textContent = txt || '';
}
function showResult(show = true){
  resultadoEl.hidden = !show;
}
function formatDateISOToLocal(dateStr, tz){
  try{
    const d = new Date(dateStr + 'Z'); // tratar como UTC se não houver fuso horário
    // toLocaleString com timeZone, com fallback se não for suportado
    return d.toLocaleString(undefined, { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
  }catch(e){
    return dateStr;
  }
}
function celsiusLabel(temp){
  return `${Math.round(temp)}°C`;
}

// Principal: buscar coordenadas pelo nome da cidade (retorna o primeiro resultado ou lança erro)
async function geocodeCity(name, signal){
  const url = `${geocodeBase}?name=${encodeURIComponent(name)}&count=5&language=pt`;
  const res = await fetch(url, { signal });
  if(!res.ok) throw new Error(`Erro geocoding ${res.status}`);
  const json = await res.json();
  if(!json.results || json.results.length === 0) throw new Error('Cidade não encontrada');
  // escolher o melhor: primeiro resultado
  return json.results[0]; // {name, latitude, longitude, country, timezone}
}

// Principal: buscar previsão pelo lat/lon
async function fetchForecast(lat, lon, tz, signal){
  // pedir tempo atual + temperaturas diárias para 3 dias
  const url = `${forecastBase}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,weathercode&current_weather=true&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=${encodeURIComponent(tz)}&forecast_days=3`;
  const res = await fetch(url, { signal });
  if(!res.ok) throw new Error(`Erro forecast ${res.status}`);
  return await res.json();
}

// Funções de renderização
function renderCurrent(city, forecastJson){
  const cw = forecastJson.current_weather;
  cityNameEl.textContent = `${city.name}, ${city.country}`;
  tempoLocalEl.textContent = `Tempo local: ${city.timezone}`;
  tempoAtualEl.textContent = `Temperatura: ${celsiusLabel(cw.temperature)}`;
  currentWeatherEl.textContent = `Vento: ${cw.windspeed} km/h | Direção: ${cw.winddirection}°`;
}

function renderForecast(forecastJson){
  // arrays diários: time, temperature_2m_max, temperature_2m_min
  const daily = forecastJson.daily;
  forecastListEl.innerHTML = '';
  for(let i=0;i<daily.time.length;i++){
    const day = daily.time[i]; // data ISO (YYYY-MM-DD)
    const tmax = daily.temperature_2m_max[i];
    const tmin = daily.temperature_2m_min[i];
    const li = document.createElement('li');
    li.innerHTML = `<strong>${day}</strong><div>Max: ${celsiusLabel(tmax)}</div><div>Min: ${celsiusLabel(tmin)}</div>`;
    forecastListEl.appendChild(li);
  }
}

// Helpers de cache (localStorage)
const CACHE_KEY = 'tempo_app_cache_v1';
function saveCache(cityName, data){
  const obj = { cityName, data, ts: Date.now() };
  try{ localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch(e){}
}
function loadCache(){
  try{
    const raw = localStorage.getItem(CACHE_KEY);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    // expirar cache depois de 30 minutos
    if(Date.now() - parsed.ts > 1000 * 60 * 30) { localStorage.removeItem(CACHE_KEY); return null; }
    return parsed;
  }catch(e){ return null; }
}

// Manipulador principal
form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const city = input.value.trim();
  if(!city) return;
  // cancelar requisição anterior
  if(currentController){
    currentController.abort();
  }
  currentController = new AbortController();
  const signal = currentController.signal;

  showResult(false);
  setStatus('Carregando...');
  // verificar cache
  const cached = loadCache();
  if(cached && cached.cityName.toLowerCase() === city.toLowerCase()){
    try{
      // mostrar cache imediatamente
      renderCurrent({name: city, country: ''}, cached.data);
      renderForecast(cached.data);
      showResult(true);
      setStatus('Dados em cache (última busca)');
    }catch(e){}
  }

  try{
    // 1) geocodificação
    const cityInfo = await geocodeCity(city, signal);
    setStatus('Buscando previsão...');
    // 2) previsão
    const forecastJson = await fetchForecast(cityInfo.latitude, cityInfo.longitude, cityInfo.timezone, signal);
    // mostrar
    renderCurrent(cityInfo, forecastJson);
    renderForecast(forecastJson);
    showResult(true);
    setStatus('');
    // salvar cache
    saveCache(city, forecastJson);
  }catch(err){
    if(err.name === 'AbortError'){
      // cancelado por nova requisição ou saída da página; silencioso
      setStatus('Requisição cancelada.');
      return;
    }
    console.error(err);
    setStatus(`Erro: ${err.message}`);
    showResult(false);
  } finally {
    // limpar controller desta requisição
    currentController = null;
  }
});

// ao carregar: tentar mostrar cache
document.addEventListener('DOMContentLoaded', () => {
  const cached = loadCache();
  if(cached){
    input.value = cached.cityName;
    try{
      renderCurrent({name: cached.cityName, country: ''}, cached.data);
      renderForecast(cached.data);
      showResult(true);
      setStatus('Usando dados em cache');
    }catch(e){}
  }
});