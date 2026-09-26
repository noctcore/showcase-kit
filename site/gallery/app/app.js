// Nightjar: a made-up observing planner, the fixture app the gallery captures.
//
// Everything is fixed: the data below, the date on the header, the positions on the sky chart. There is no clock,
// no randomness and no network, so two captures of the same view are the same pixels. The language comes from the
// browser locale, which showcase-kit sets per entry in `langs`.

const STRINGS = {
  en: {
    nav: { tonight: 'Tonight', log: 'Log', gear: 'Gear' },
    site: 'Observing site',
    siteName: 'Hilltop field, Bortle 4',
    date: 'Saturday, 14 September 2026',
    moon: 'Moon 12%',
    tonight: {
      title: 'Tonight',
      subtitle: 'Six targets fit the dark window.',
      stats: [
        ['Seeing', '4 / 5', 'Steady above 40°'],
        ['Transparency', 'Good', 'Limiting mag. 6.3'],
        ['Moon', '12%', 'Sets at 21:37'],
        ['Dark window', '21:04 to 04:12', '7 h 8 min'],
      ],
      targets: 'Targets',
      columns: ['Object', 'Type', 'Mag.', 'Altitude', 'Best at', 'Status'],
      chart: 'Sky at 23:00',
      horizon: 'Horizon',
    },
    log: {
      title: 'Log',
      subtitle: 'Every session, with the conditions you noted.',
      stats: [
        ['Sessions', '42'],
        ['Objects', '131'],
        ['Hours', '86'],
      ],
      columns: ['Date', 'Object', 'Instrument', 'Seeing', 'Rating', 'Notes'],
    },
    gear: {
      title: 'Gear',
      subtitle: 'What goes in the car on a clear night.',
      lastUsed: 'Last used',
      checklist: 'Before you leave',
      items: ['Batteries charged', 'Red light only', 'Star charts printed', 'Dew heater packed', 'Collimation checked', 'Warm layers'],
    },
    types: { globular: 'Globular cluster', planetary: 'Planetary nebula', galaxy: 'Galaxy', double: 'Double star' },
    status: { up: 'Up now', rising: 'Rising', done: 'Observed' },
    cardinals: ['N', 'E', 'S', 'W'],
  },
  pl: {
    nav: { tonight: 'Dziś w nocy', log: 'Dziennik', gear: 'Sprzęt' },
    site: 'Miejsce obserwacji',
    siteName: 'Łąka na wzgórzu, Bortle 4',
    date: 'Sobota, 14 września 2026',
    moon: 'Księżyc 12%',
    tonight: {
      title: 'Dziś w nocy',
      subtitle: 'Sześć obiektów mieści się w oknie ciemności.',
      stats: [
        ['Seeing', '4 / 5', 'Stabilnie powyżej 40°'],
        ['Przejrzystość', 'Dobra', 'Zasięg 6,3 mag'],
        ['Księżyc', '12%', 'Zachód o 21:37'],
        ['Okno ciemności', '21:04 do 04:12', '7 h 8 min'],
      ],
      targets: 'Obiekty',
      columns: ['Obiekt', 'Typ', 'Jasn.', 'Wysokość', 'Najlepiej', 'Status'],
      chart: 'Niebo o 23:00',
      horizon: 'Horyzont',
    },
    log: {
      title: 'Dziennik',
      subtitle: 'Każda sesja razem z zanotowanymi warunkami.',
      stats: [
        ['Sesje', '42'],
        ['Obiekty', '131'],
        ['Godziny', '86'],
      ],
      columns: ['Data', 'Obiekt', 'Instrument', 'Seeing', 'Ocena', 'Notatki'],
    },
    gear: {
      title: 'Sprzęt',
      subtitle: 'To, co jedzie w bagażniku w pogodną noc.',
      lastUsed: 'Ostatnio',
      checklist: 'Przed wyjazdem',
      items: ['Baterie naładowane', 'Tylko czerwone światło', 'Mapy nieba wydrukowane', 'Grzałka spakowana', 'Kolimacja sprawdzona', 'Ciepłe ubranie'],
    },
    types: { globular: 'Gromada kulista', planetary: 'Mgławica planetarna', galaxy: 'Galaktyka', double: 'Gwiazda podwójna' },
    status: { up: 'Widoczny', rising: 'Wschodzi', done: 'Zaobserwowany' },
    cardinals: ['Pn', 'Wsch', 'Pd', 'Zach'],
  },
};

// Azimuth and altitude are for the sky chart at 23:00; `alt` is the altitude bar in the table.
const TARGETS = [
  { id: 'M13', name: { en: 'Hercules Cluster', pl: 'Gromada w Herkulesie' }, type: 'globular', mag: 5.8, alt: 62, best: '21:30', status: 'done', az: 280, chartAlt: 35 },
  { id: 'M57', name: { en: 'Ring Nebula', pl: 'Mgławica Pierścień' }, type: 'planetary', mag: 8.8, alt: 78, best: '22:10', status: 'up', az: 250, chartAlt: 70 },
  { id: 'M27', name: { en: 'Dumbbell Nebula', pl: 'Mgławica Hantle' }, type: 'planetary', mag: 7.5, alt: 66, best: '22:40', status: 'up', az: 190, chartAlt: 48 },
  { id: 'Albireo', name: { en: 'Beta Cygni', pl: 'Beta Łabędzia' }, type: 'double', mag: 3.1, alt: 71, best: '23:00', status: 'up', az: 160, chartAlt: 72 },
  { id: 'M31', name: { en: 'Andromeda Galaxy', pl: 'Galaktyka Andromedy' }, type: 'galaxy', mag: 3.4, alt: 44, best: '02:15', status: 'rising', az: 75, chartAlt: 38 },
  { id: 'M81', name: { en: "Bode's Galaxy", pl: 'Galaktyka Bodego' }, type: 'galaxy', mag: 6.9, alt: 31, best: '03:40', status: 'rising', az: 20, chartAlt: 30 },
];

const LOG = [
  { date: '2026-09-12', object: 'M13', instrument: '200 mm Dob', seeing: 4, rating: 5, notes: { en: 'Resolved to the core at 150x.', pl: 'Rozdzielona do jądra przy 150x.' } },
  { date: '2026-09-12', object: 'M57', instrument: '200 mm Dob', seeing: 4, rating: 4, notes: { en: 'Central star glimpsed twice.', pl: 'Centralna gwiazda mignęła dwa razy.' } },
  { date: '2026-09-03', object: 'NGC 7000', instrument: '80 mm APO', seeing: 3, rating: 4, notes: { en: 'Clear outline with the OIII filter.', pl: 'Wyraźny kształt z filtrem OIII.' } },
  { date: '2026-08-29', object: 'M31', instrument: '10x50', seeing: 3, rating: 3, notes: { en: 'Dust lane hinted, low haze.', pl: 'Pas pyłu ledwo widoczny, lekka mgiełka.' } },
  { date: '2026-08-21', object: 'Albireo', instrument: '80 mm APO', seeing: 5, rating: 5, notes: { en: 'Gold and blue, split at 40x.', pl: 'Złota i niebieska, rozdzielone przy 40x.' } },
  { date: '2026-08-14', object: 'M27', instrument: '200 mm Dob', seeing: 3, rating: 4, notes: { en: 'Apple core shape obvious.', pl: 'Kształt ogryzka jabłka oczywisty.' } },
  { date: '2026-08-02', object: 'Saturn', instrument: '200 mm Dob', seeing: 4, rating: 5, notes: { en: 'Cassini division all the way round.', pl: 'Przerwa Cassiniego na całym obwodzie.' } },
  { date: '2026-07-26', object: 'M81 / M82', instrument: '10x50', seeing: 2, rating: 3, notes: { en: 'Both in one field, faint.', pl: 'Obie w jednym polu, słabe.' } },
];

const GEAR = [
  { icon: 'scope', name: { en: '200 mm Dobsonian', pl: 'Dobson 200 mm' }, specs: [['Focal length', 'Ogniskowa', '1200 mm'], ['Ratio', 'Światłosiła', 'f/5.9'], ['Mount', 'Montaż', 'Dobson']], used: '2026-09-12' },
  { icon: 'scope', name: { en: '80 mm apochromat', pl: 'Apochromat 80 mm' }, specs: [['Focal length', 'Ogniskowa', '480 mm'], ['Ratio', 'Światłosiła', 'f/6'], ['Mount', 'Montaż', 'Alt-az']], used: '2026-09-03' },
  { icon: 'binoculars', name: { en: '10x50 binoculars', pl: 'Lornetka 10x50' }, specs: [['Field', 'Pole', '6.5°'], ['Exit pupil', 'Źrenica', '5 mm'], ['Weight', 'Waga', '0.9 kg']], used: '2026-08-29' },
  { icon: 'eyepiece', name: { en: 'Eyepiece case', pl: 'Walizka okularów' }, specs: [['Wide', 'Szerokie', '24 mm, 68°'], ['Medium', 'Średnie', '13 mm, 82°'], ['High', 'Duże', '8 mm, 82°']], used: '2026-09-12' },
  { icon: 'filter', name: { en: 'OIII filter', pl: 'Filtr OIII' }, specs: [['Pass band', 'Pasmo', '496 to 501 nm'], ['Size', 'Rozmiar', '2 inch'], ['Best on', 'Najlepszy do', { en: 'Nebulae', pl: 'Mgławice' }]], used: '2026-09-03' },
  { icon: 'chart', name: { en: 'Red flashlight', pl: 'Czerwona latarka' }, specs: [['Levels', 'Poziomy', '3'], ['Battery', 'Bateria', 'AA'], ['Runtime', 'Czas pracy', '40 h']], used: '2026-09-12' },
];

const ICONS = {
  tonight: '<path d="M15 4a8 8 0 1 0 5 14.3A9 9 0 0 1 15 4Z"/>',
  log: '<path d="M6 4h10l3 3v13H6z"/><path d="M9 10h7M9 14h7M9 18h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  scope: '<path d="M4 15l12-7 2 4-12 7z"/><path d="M10 17l-2 5M12 16l3 6"/>',
  binoculars: '<circle cx="7" cy="15" r="4"/><circle cx="17" cy="15" r="4"/><path d="M7 11V5h3v6M17 11V5h-3v6M10 13h4"/>',
  eyepiece: '<rect x="8" y="3" width="8" height="6" rx="1"/><path d="M9 9h6l-1 12h-4z"/>',
  filter: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>',
  chart: '<path d="M9 3h6v5l-2 3v10h-2V11L9 8z"/>',
};

const lang = (navigator.language || 'en').slice(0, 2) === 'pl' ? 'pl' : 'en';
const t = STRINGS[lang];
document.documentElement.lang = lang;

const num = value => (lang === 'pl' ? String(value).replace('.', ',') : String(value));
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const stars = count => `<span class="stars" aria-label="${count} / 5">${'★'.repeat(count)}<span>${'★'.repeat(5 - count)}</span></span>`;
const dots = count => `<span class="dots">${'<i class="on"></i>'.repeat(count)}${'<i></i>'.repeat(5 - count)}</span>`;
const date = iso => (lang === 'pl' ? iso.split('-').reverse().join('.') : iso);

function header(title, subtitle) {
  return `<header class="head">
    <div><h1>${title}</h1><p>${subtitle}</p></div>
    <div class="meta"><span>${t.date}</span><span class="pill">${t.moon}</span></div>
  </header>`;
}

function skyChart() {
  const size = 280;
  const c = size / 2;
  const r = c - 42;
  const point = (az, alt) => {
    const radius = r * (1 - alt / 90);
    const angle = ((az - 90) * Math.PI) / 180;
    return [c + radius * Math.cos(angle), c + radius * Math.sin(angle)];
  };
  const labels = t.cardinals
    .map((label, index) => {
      const [x, y] = point(index * 90, -14);
      return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}">${label}</text>`;
    })
    .join('');
  const marks = TARGETS.map(target => {
    const [x, y] = point(target.az, target.chartAlt);
    return `<circle class="star ${target.status}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5"/><text class="name" x="${(x + 9).toFixed(1)}" y="${(y + 4).toFixed(1)}">${target.id}</text>`;
  }).join('');
  return `<svg class="sky" viewBox="0 0 ${size} ${size}" role="img" aria-label="${t.tonight.chart}">
    <circle class="ring" cx="${c}" cy="${c}" r="${r}"/>
    <circle class="ring faint" cx="${c}" cy="${c}" r="${(r * 2) / 3}"/>
    <circle class="ring faint" cx="${c}" cy="${c}" r="${r / 3}"/>
    <path class="ring faint" d="M${c} ${c - r}V${c + r}M${c - r} ${c}H${c + r}"/>
    ${labels}${marks}
  </svg>`;
}

function tonight() {
  const s = t.tonight;
  const stats = s.stats
    .map(([label, value, note]) => `<div class="stat"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`)
    .join('');
  const rows = TARGETS.map(
    target => `<tr>
      <td><strong>${target.id}</strong><small>${target.name[lang]}</small></td>
      <td class="wrap">${t.types[target.type]}</td>
      <td class="mono">${num(target.mag)}</td>
      <td><span class="bar"><span style="width:${target.alt}%"></span></span><span class="mono">${target.alt}°</span></td>
      <td class="mono">${target.best}</td>
      <td><span class="chip ${target.status}">${t.status[target.status]}</span></td>
    </tr>`,
  ).join('');
  return `${header(s.title, s.subtitle)}
    <section class="stats">${stats}</section>
    <section class="split">
      <div class="card"><h2>${s.targets}</h2>
        <table><thead><tr>${s.columns.map(column => `<th>${column}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      </div>
      <div class="card chart"><h2>${s.chart}</h2>${skyChart()}</div>
    </section>`;
}

function log() {
  const s = t.log;
  const stats = s.stats.map(([label, value]) => `<div class="stat small"><span>${label}</span><strong>${value}</strong></div>`).join('');
  const rows = LOG.map(
    entry => `<tr>
      <td class="mono">${date(entry.date)}</td>
      <td><strong>${entry.object}</strong></td>
      <td>${entry.instrument}</td>
      <td>${dots(entry.seeing)}</td>
      <td>${stars(entry.rating)}</td>
      <td class="notes">${entry.notes[lang]}</td>
    </tr>`,
  ).join('');
  return `${header(s.title, s.subtitle)}
    <section class="stats three">${stats}</section>
    <div class="card"><table class="log"><thead><tr>${s.columns.map(column => `<th>${column}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function gear() {
  const s = t.gear;
  const cards = GEAR.map(
    item => `<article class="card gear">
      <div class="gear-head">${icon(item.icon)}<h2>${item.name[lang]}</h2></div>
      <dl>${item.specs.map(([en, pl, value]) => `<dt>${lang === 'pl' ? pl : en}</dt><dd>${typeof value === 'string' ? num(value) : value[lang]}</dd>`).join('')}</dl>
      <p class="used">${s.lastUsed} <span class="mono">${date(item.used)}</span></p>
    </article>`,
  ).join('');
  // The last item is still open, so the list reads as a checklist in progress.
  const checklist = s.items
    .map((item, index) => `<li class="${index < s.items.length - 1 ? 'on' : ''}"><span class="box"></span>${item}</li>`)
    .join('');
  return `${header(s.title, s.subtitle)}<section class="grid">${cards}</section>
    <div class="card"><h2>${s.checklist}</h2><ul class="checklist">${checklist}</ul></div>`;
}

const VIEWS = { tonight, log, gear };

function render(view) {
  const nav = Object.keys(VIEWS)
    .map(
      name =>
        `<button type="button" data-view="${name}" aria-current="${name === view ? 'page' : 'false'}">${icon(name)}${t.nav[name]}</button>`,
    )
    .join('');
  document.getElementById('app').innerHTML = `
    <aside class="side">
      <div class="brand"><img src="/mark.svg" alt="" width="32" height="32" /><span>Nightjar</span></div>
      <nav>${nav}</nav>
      <div class="site"><span>${t.site}</span><strong>${t.siteName}</strong><small class="mono">52.23° N, 21.01° E</small></div>
    </aside>
    <main data-current-view="${view}">${VIEWS[view]()}</main>`;
  document.getElementById('app').dataset.ready = 'true';
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-view]');
  if (button) render(button.dataset.view);
});

render('tonight');
