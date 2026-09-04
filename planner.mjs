/**
 * Pure London trip planning helpers. No DOM, storage, network, or dependencies.
 *
 * Data: {flights:{variants,luggage,reissue,route,booking?}, events:Item[],
 *        places:Item[]|{places:Item[],practical:Item[]}}.
 * Item dates may be date:"YYYY-MM-DD", ISO start/end datetimes, inclusive
 * start/end date ranges, or absent (an unscheduled option, not an appointment).
 * Optional availableWeekdays uses 0=Sunday..6=Saturday. Optional sessions is
 * a trusted list of {id,date,start,end,label}, restricted to 14–19 October.
 *
 * State: {version:1,variant,selected:string[],attendees:{id:1|2|3|4|5},
 * eurPLN,gbpPLN,reissueExtraPLN,bag:"pending"|"included"|"extra",
 * etaCount:0|1|2,foodGBP,prices:{id:perPersonGBP},dates:{id:"YYYY-MM-DD"},sessions:{itemId:sessionId}}.
 *
 * Prices are rounded only at line / total boundaries. Two travellers always
 * fly; attraction attendance is independent, from 1 to 5 people. Local guests
 * do not increase flight, airport, food or ETA traveller counts. This is a planning model, not
 * a live quotation or a guarantee that selected tickets are available.
 */
const DEFAULT_IDS = ["massaoke", "hadestown", "adja", "kenwood-choir"];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const object = x => x && typeof x === "object" && !Array.isArray(x) ? x : {};
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function itemList(data = {}) {
  const events = Array.isArray(data.events) ? data.events : data.events?.events || [];
  const places = Array.isArray(data.places) ? data.places : data.places?.places || [];
  const seen = new Set();
  return [...events, ...places].filter(x => {
    if (!x || typeof x.id !== "string" || seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  });
}
function variants(data) { return Array.isArray(data?.flights?.variants) ? data.flights.variants : []; }
// Confirmed booking facts are trusted published data, never local/hash overrides.
function confirmedBooking(data) { return data?.flights?.booking?.confirmed === true ? data.flights.booking : null; }
function number(value, fallback, min, max) {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  if (typeof value === "string" && !value.trim()) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
function datePart(value) {
  if (typeof value !== "string") return null;
  const d = value.slice(0, 10);
  return DATE.test(d) ? d : null;
}
function minutes(value) {
  if (typeof value !== "string") return null;
  const t = value.includes("T") ? value.split("T")[1].slice(0, 5) : value;
  const m = t.match(TIME);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function sessionsFor(item) {
  if (!Array.isArray(item.sessions)) return [];
  const seen = new Set();
  return item.sessions.slice(0,100).filter(session => {
    if (!session || typeof session.id!=="string" || session.id.length>100 || seen.has(session.id)) return false;
    if (typeof session.date!=="string" || !DATE.test(session.date) || session.date<"2026-10-14" || session.date>"2026-10-19") return false;
    if (minutes(session.start)===null || (session.end!=null && minutes(session.end)===null)) return false;
    seen.add(session.id);
    return true;
  });
}
function defaultSession(item) {
  const sessions=sessionsFor(item);
  return sessions.find(x=>x.id===item.defaultSession)
    || sessions.find(x=>x.date===exactDate(item) && minutes(x.start)===minutes(item.start))
    || sessions[0];
}
function weekdayClosed(item) {
  const date=exactDate(item);
  if (!date || !Array.isArray(item.availableWeekdays)) return false;
  return !item.availableWeekdays.includes(new Date(date+"T00:00:00Z").getUTCDay());
}
function exactDate(item) {
  return datePart(item.date) || (typeof item.start === "string" && item.start.includes("T") ? datePart(item.start) : null);
}
function bounds(item) {
  const d = exactDate(item);
  if (d) return [d, d];
  const from = datePart(item.startDate || item.dateStart || item.start);
  const to = datePart(item.endDate || item.dateEnd || item.end);
  return [from, to];
}
function inVisit(item, trip) {
  if (item.dateOutsideAvailability || item.closedOnAssignedDay) return false;
  if (!trip) return true;
  const [from, to] = bounds(item);
  return !(to && to < trip.departure) && !(from && from > trip.return);
}
function tripFor(state, data) { return variants(data).find(x => x.id === state.variant) || null; }
function selectedItems(state, data) {
  const ids = new Set(state.selected);
  return itemList(data).filter(x => ids.has(x.id)).map(item => {
    const availableSessions=sessionsFor(item);
    const session=availableSessions.find(x=>x.id===state.sessions[item.id]);
    let resolved=item;
    if (session) {
      resolved={...item,date:session.date,start:session.start,end:session.end??null,
        sessionId:session.id,sessionLabel:session.label||session.id};
    } else {
      const assigned = state.dates[item.id];
      if (assigned && !exactDate(item) && !availableSessions.length) {
        const [from, to] = bounds(item);
        resolved={...item,date:assigned,scheduledByUser:true,
          dateOutsideAvailability:Boolean((from && assigned < from) || (to && assigned > to))};
      }
    }
    if (weekdayClosed(resolved)) resolved={...resolved,closedOnAssignedDay:true};
    return resolved;
  });
}
function warning(code, itemIds, message, severity = "warning") {
  return {code, itemIds, message, severity};
}
function interval(item) {
  const date = exactDate(item);
  const start = minutes(item.start);
  if (!date || start === null) return null;
  let end = minutes(item.end);
  if (end === null && Number.isFinite(item.durationMinutes) && item.durationMinutes > 0) end = start + item.durationMinutes;
  if (end === null) return null;
  if (end <= start) end += 24 * 60;
  const base = Date.parse(date + "T00:00:00Z") / 60000;
  return [base + start, base + end];
}
function doorsMinutes(item) {
  const direct = minutes(item.doors);
  if (direct !== null) return direct;
  // Door time is used ONLY as a flight-logistics lower bound, never as a
  // fabricated artist start or as an overlap interval.
  const found = String(item.timeNote || "").match(/drzwi\s+([0-2]\d:[0-5]\d)/i);
  return found ? minutes(found[1]) : null;
}

/** Creates fresh defaults. No caller data or object is mutated. */
export function defaultState(data = {}) {
  const items = itemList(data);
  const ids = new Set(items.map(x => x.id));
  const options = variants(data);
  const booking = confirmedBooking(data);
  return {
    version: 1,
    variant: booking?.variantId || (options.find(x => x.recommended) || options[0])?.id || "15-19",
    selected: DEFAULT_IDS.filter(id => ids.has(id)),
    attendees: Object.fromEntries(items.map(x => [x.id, 2])),
    eurPLN: 4.33,
    gbpPLN: 5,
    reissueExtraPLN: 0,
    bag: booking ? "included" : "pending",
    etaCount: 2,
    foodGBP: 35,
    prices: {},
    dates: {},
    sessions: Object.fromEntries(items.filter(x=>defaultSession(x)).map(x=>[x.id,defaultSession(x).id]))
  };
}

/** Whitelists identifiers, types and bounded numbers. Empty selections survive.
 * A confirmed booking overrides obsolete flight/bag inputs while preserving
 * attractions, sessions, attendance, price overrides and other trip settings.
 * Version 1 localStorage and hash payloads remain backwards-compatible. */
export function sanitizeState(raw, data = {}) {
  const base = defaultState(data);
  const booking = confirmedBooking(data);
  const input = object(raw);
  const valid = new Set(itemList(data).map(x => x.id));
  const rawAttendees = object(input.attendees);
  const rawPrices = object(input.prices);
  const rawDates = object(input.dates);
  const rawSessions = object(input.sessions);
  const state = {...base, attendees: {...base.attendees}, prices: {}, dates: {}, sessions: {...base.sessions}};
  if (!booking && variants(data).some(x => x.id === input.variant)) state.variant = input.variant;
  if (Array.isArray(input.selected)) state.selected = [...new Set(input.selected.filter(x => typeof x === "string" && valid.has(x)))];
  for (const id of valid) {
    const count = number(rawAttendees[id], 2, 1, 5);
    state.attendees[id] = Number.isInteger(count) ? count : 2;
    if (own(rawPrices, id)) {
      const value = number(rawPrices[id], null, 0, 10000);
      if (value !== null) Object.defineProperty(state.prices, id, {value, enumerable:true, configurable:true, writable:true});
    }
  }
  for (const item of itemList(data)) {
    const chosen=rawSessions[item.id];
    if (typeof chosen==="string" && sessionsFor(item).some(x=>x.id===chosen))
      Object.defineProperty(state.sessions,item.id,{value:chosen,enumerable:true,configurable:true,writable:true});
    const date = rawDates[item.id];
    if (!sessionsFor(item).length && !exactDate(item) && typeof date==="string" && DATE.test(date) && date >= "2026-10-14" && date <= "2026-10-19")
      Object.defineProperty(state.dates,item.id,{value:date,enumerable:true,configurable:true,writable:true});
  }
  state.eurPLN = number(input.eurPLN, base.eurPLN, 0.01, 100);
  state.gbpPLN = number(input.gbpPLN, base.gbpPLN, 0.01, 100);
  state.foodGBP = number(input.foodGBP, base.foodGBP, 0, 1000);
  state.reissueExtraPLN = booking ? 0 : number(input.reissueExtraPLN, 0, 0, 1000000);
  const eta = number(input.etaCount, 2, 0, 2);
  state.etaCount = Number.isInteger(eta) ? eta : 2;
  if (!booking && ["pending", "included", "extra"].includes(input.bag)) state.bag = input.bag;
  return state;
}

/**
 * Selected items whose known dates intersect the visit. Flexible entries are
 * shallow-copied with a user-assigned date; fixed dates cannot be overwritten.
 * A verified session is resolved before user dates. Closed weekdays are excluded.
 * A user date outside a published availability range is excluded with warning.
 */
export function activeItems(rawState, data = {}) {
  const state = sanitizeState(rawState, data);
  const trip = tripFor(state, data);
  return selectedItems(state, data).filter(x => inVisit(x, trip));
}

/**
 * Returns Warning[]: {code,itemIds:string[],message,severity:"warning"|"error"}.
 * Explicit alternatives are de-duplicated with computed time overlaps.
 * Flight buffers are planning assumptions: 4 h after landing for a host-first
 * arrival, 3 h before takeoff, plus a caution zone up to 4 h before takeoff.
 */
export function conflicts(rawState, data = {}) {
  const state = sanitizeState(rawState, data);
  const trip = tripFor(state, data);
  const selected = selectedItems(state, data);
  const active = selected.filter(x => inVisit(x, trip));
  const issues = [];
  for (const item of selected) {
    if (item.closedOnAssignedDay) issues.push(warning("closed-day",[item.id],item.title + ": wybrany dzień jest poza regularnymi dniami działania; pozycja nie jest liczona w budżecie."));
    else if (item.dateOutsideAvailability) issues.push(warning("outside-availability",[item.id],item.title + ": wybrany dzień wypada poza potwierdzonym okresem wydarzenia; nie jest liczony w budżecie."));
    else if (!inVisit(item, trip)) issues.push(warning("outside-visit", [item.id], item.title + ": znany termin wypada poza wybranym pobytem; nie jest liczony w budżecie."));
    if (String(item.availability).replace(/[-_ ]/g, "").toLowerCase() === "soldout") issues.push(warning("soldout", [item.id], item.title + ": obecnie wyprzedane — wyłącznie rezerwa na zwroty."));
    if (item.availability === "schedule-only") issues.push(warning("schedule-unconfirmed", [item.id], item.title + ": znamy regularny rozkład, ale nie potwierdziliśmy konkretnej daty i miejsc."));
  }
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const explicit = a.conflicts?.includes(b.id) || b.conflicts?.includes(a.id);
      const ia = interval(a), ib = interval(b);
      const overlap = ia && ib && ia[0] < ib[1] && ib[0] < ia[1];
      const sameDate=exactDate(a) && exactDate(a)===exactDate(b);
      const uncertainSameDay=explicit && sameDate && (!ia || !ib);
      if (uncertainSameDay || overlap) issues.push(warning(overlap ? "time-overlap" : "alternatives", [a.id,b.id],
        a.title + " / " + b.title + (overlap ? ": wskazane godziny nachodzą na siebie." : ": to konkurencyjne propozycje — wybierz jedną.")));
    }
  }
  if (!trip) return issues;
  const arrival = minutes(trip.arrival), departure = minutes(trip.back);
  for (const item of active) {
    const date = exactDate(item);
    if (!date) continue;
    const start = minutes(item.start), doors = doorsMinutes(item);
    const knownStart = start ?? doors;
    const itemInterval = interval(item);
    const end = itemInterval ? itemInterval[1] - Date.parse(date + "T00:00:00Z") / 60000 : minutes(item.end);
    const fixedEvent = ["concert","singing","musical","music"].includes(item.category);
    if (date === trip.departure && arrival !== null) {
      if (knownStart !== null && knownStart < arrival) issues.push(warning("arrival-conflict", [item.id], item.title + ": wydarzenie zaczyna się przed przylotem albo przed otwarciem realnego okna dojazdu.", "error"));
      else if (knownStart !== null && knownStart < arrival + 240) issues.push(warning("arrival-buffer", [item.id], item.title + ": mniej niż 4 godziny od lądowania; po granicy, bagażu, dojeździe i wizycie u gospodarza może być ciasno. Nie planuj obowiązkowo."));
      else if (knownStart === null && fixedEvent) issues.push(warning("arrival-time-unknown", [item.id], item.title + ": w dniu przylotu, ale godzina sesji niepotwierdzona. Najpierw sprawdź logistykę."));
    }
    if (date === trip.return && departure !== null) {
      const sharedBagReturn = trip.return === "2026-10-19";
      const leaveForAirport = sharedBagReturn ? 13 * 60 : departure - 180;
      const tightAfter = sharedBagReturn ? 12 * 60 : departure - 240;
      const returnExplanation = sharedBagReturn ? "Wróćcie po walizkę do Marcina przed 13:15; wyjazd z Brent Cross planujemy na 13:15–13:45." : "Rezerwujemy 3 godziny przed odlotem na dojazd i lotnisko.";
      if (knownStart !== null && knownStart >= leaveForAirport) issues.push(warning("return-flight", [item.id], item.title + ": koliduje z powrotem. " + returnExplanation, "error"));
      else if (end !== null && end > leaveForAirport) issues.push(warning("return-buffer", [item.id], item.title + ": kończy się za późno. " + returnExplanation, "error"));
      else if (end !== null && end > tightAfter) issues.push(warning("return-tight", [item.id], item.title + ": po atrakcji zostaje mało czasu na odbiór bagażu i dojazd. " + returnExplanation));
      else if (knownStart === null && fixedEvent) issues.push(warning("return-time-unknown", [item.id], item.title + ": godzina niepotwierdzona w dniu wylotu; wieczornego koncertu nie da się pogodzić z lotem."));
    }
  }
  return issues;
}

/**
 * Budget return:
 * {variant,nights,days,travellers:2,lines:Line[],activities:Activity[],
 * flightPLN,baggagePLN,etaGBP,urbanGBP,airportGBP,foodGBP,activitiesGBP,
 * knownTotalPLN,totalPLN,bookingConfirmed,paidFlightPLN,remainingKnownPLN,remainingPLN,
 * alreadyPaidPLN:null,priorTicketExcluded:true,hasUnknownPrices,
 * unknownItems:string[],estimatedItems:string[],excludedItems:string[],warnings:Warning[]}.
 *
 * Line={id,label,amountPLN,amountGBP?,estimated,details}.
 * Activity={id,title,attendees,unitGBP,feeGBP,costGBP,costPLN,estimated,
 * unknown,priceSource:"data"|"override"}.
 * Unknown activity prices remain null. totalPLN is null if any are missing;
 * knownTotalPLN is a PARTIAL subtotal and must not be displayed as a complete quote.
 * The original ticket cost is intentionally not published; alreadyPaidPLN is
 * null and priorTicketExcluded is true. It never enters new expenditure.
 * Confirmed flights are counted once as paid cost, independently of exchange
 * rates and obsolete reissue/baggage state. Remaining amounts exclude them.
 */
export function budget(rawState, data = {}) {
  const state = sanitizeState(rawState, data);
  const trip = tripFor(state, data);
  const active = activeItems(state, data);
  const selected = selectedItems(state, data);
  const warnings = conflicts(state, data);
  const nights = trip ? Math.max(0, Math.round((Date.parse(trip.return) - Date.parse(trip.departure)) / 86400000)) : 0;
  const days = nights + 1;
  const travellers = 2;
  const booking = confirmedBooking(data);
  const bookingConfirmed = Boolean(booking);
  const ticket = number(trip?.newTicket, null, 0, 1000000);
  const feeEUR = number(data.flights?.reissue?.feeEUR, 70, 0, 1000000);
  const exchangePaidPLN = number(booking?.exchangePaidPLN, null, 0, 1000000);
  const kostekPaidPLN = number(booking?.kostekPaidPLN, null, 0, 1000000);
  const flightPLN = bookingConfirmed
    ? (exchangePaidPLN === null || kostekPaidPLN === null ? null : round(exchangePaidPLN + kostekPaidPLN))
    : (ticket === null ? null : round(ticket + feeEUR * state.eurPLN + state.reissueExtraPLN));
  const paidFlightPLN = bookingConfirmed ? flightPLN : 0;
  const baggagePLN = !bookingConfirmed && state.bag === "extra" ? number(data.flights?.luggage?.fallback, 233, 0, 1000000) : 0;
  const baggageEstimate = !bookingConfirmed && state.bag === "extra" && trip?.id !== "15-19";
  const etaGBP = state.etaCount * number(data.places?.practical?.find(x=>x.id==="eta")?.priceGBP,20,0,10000);
  const urbanGBP = round(Math.max(0, nights - 1) * 10.5 * travellers);
  const airportGBP = round(number(data.flights?.route?.fareGBP,15.5,0,1000) * 2 * travellers);
  const foodGBP = round(state.foodGBP * travellers * days);
  const activities = active.map(item => {
    const overridden = own(state.prices,item.id);
    const unitGBP = overridden ? state.prices[item.id] : number(item.priceGBP,null,0,10000);
    const attendees = state.attendees[item.id];
    // These special fees are per order (BFI / Water Body capped at £3).
    const orderFeeGBP = item.id === "mike-lindup" ? 1.5 : ["water-body","bfi"].includes(item.id) ? Math.min(3,attendees) : 0;
    // Optional source-backed fee is additional to the per-person ticket price,
    // including a user base-price override. Do not use it for fee-inclusive prices.
    const feeGBP = round(orderFeeGBP + number(item.feePerPersonGBP,0,0,1000) * attendees);
    const unknown = unitGBP === null;
    const estimated = !unknown && (overridden || (unitGBP > 0 && !["verified","official-fee"].includes(item.priceStatus)));
    return {id:item.id,title:item.title,attendees,unitGBP,feeGBP,
      costGBP:unknown?null:round(unitGBP*attendees+feeGBP),
      costPLN:unknown?null:round((unitGBP*attendees+feeGBP)*state.gbpPLN),
      estimated,unknown,priceSource:overridden?"override":"data"};
  });
  const unknownItems = activities.filter(x=>x.unknown).map(x=>x.id);
  const estimatedItems = activities.filter(x=>x.estimated).map(x=>x.id);
  const excludedItems = selected.filter(x=>!inVisit(x,trip)).map(x=>x.id);
  const activitiesGBP = round(activities.reduce((sum,x)=>sum+(x.costGBP??0),0));
  if (unknownItems.length) warnings.push(warning("unknown-prices",unknownItems,"Brakuje cen zaznaczonych atrakcji. Ich koszt nie wynosi zero; pokazana suma jest niepełna."));
  if (estimatedItems.length) warnings.push(warning("estimated-prices",estimatedItems,"Część cen to budżety planistyczne, widełki lub własne wpisy, a nie aktualna oferta wybranych miejsc."));
  if (state.bag==="pending") warnings.push(warning("baggage-pending",[],"Bagaż do potwierdzenia przy wymianie biletu. Na razie nie dodano dopłaty; awaryjny wariant Standard kosztował 233 zł."));
  if (baggageEstimate) warnings.push(warning("baggage-estimate",[],"Dopłata 233 zł została sprawdzona tylko dla 15–19 X. Dla wybranego terminu jest estymacją."));
  if (flightPLN===null) warnings.push(warning("flight-price-unknown",[],bookingConfirmed
    ? "Brakuje pełnej kwoty opłaconych lotów w danych; suma niepełna."
    : "Brak ceny nowego biletu dla wybranego wariantu; suma niepełna."));
  const lines = [
    {id:"flights",label:bookingConfirmed?"Loty — opłacone (2 osoby)":"Loty: nowy bilet Kostka + zmiana biletu Mieszka",amountPLN:flightPLN,estimated:!bookingConfirmed,
      details:bookingConfirmed
        ? "Opłacone: całkowita dopłata Mieszka "+exchangePaidPLN+" PLN + bilet Kostka "+kostekPaidPLN+" PLN. Bez ponownego doliczania opłaty za zmianę ani wartości starego biletu."
        : "Dokładnie 2 podróżnych. "+feeEUR+" EUR opłaty + rzeczywista dopłata z infolinii "+state.reissueExtraPLN+" zł; publiczna cena nie służy do wyliczania różnicy taryf."},
    {id:"baggage",label:"Jedna wspólna walizka, obie strony",amountPLN:baggagePLN,estimated:baggageEstimate,
      details:bookingConfirmed?"Jedna wspólna walizka rejestrowana na obu odcinkach jest w cenie opłaconych biletów.":state.bag==="extra"?"Dopłata do pakietu Standard raz RT, nie dwa bagaże ani opłata za każdy odcinek.":state.bag==="included"?"Założenie: infolinia potwierdziła walizkę na obu odcinkach.":"Status niepotwierdzony, dopłata na razie poza sumą."},
    {id:"accommodation",label:"Nocleg u gospodarza",amountPLN:0,estimated:false,details:"Bez kosztu hotelu."},
    {id:"eta",label:"ETA dla osób, które jej potrzebują",amountGBP:etaGBP,amountPLN:round(etaGBP*state.gbpPLN),estimated:false,details:state.etaCount+" × £20; gospodarz nie jest doliczany."},
    {id:"airport",label:"Lotnisko ↔ baza, dwoje podróżnych",amountGBP:airportGBP,amountPLN:round(airportGBP*state.gbpPLN),estimated:true,details:"2 osoby × 2 przejazdy × £15,50; migawka planera, nie gwarancja taryfy."},
    {id:"urban",label:"Komunikacja w pełne dni pobytu",amountGBP:urbanGBP,amountPLN:round(urbanGBP*state.gbpPLN),estimated:true,details:Math.max(0,nights-1)+" dni × 2 osoby × cap £10,50. Cap to limit, nie obowiązkowy wydatek; dni lotniskowe osobno."},
    {id:"food",label:"Jedzenie dla dwojga",amountGBP:foodGBP,amountPLN:round(foodGBP*state.gbpPLN),estimated:true,details:days+" dni × 2 osoby × £"+state.foodGBP+". W tym posiłki na targach — nie doliczamy ich drugi raz."},
    {id:"activities",label:unknownItems.length?"Atrakcje — znana część kosztu":"Wybrane atrakcje",amountGBP:activitiesGBP,amountPLN:round(activitiesGBP*state.gbpPLN),estimated:estimatedItems.length>0,
      details:"Uczestnicy liczeni osobno dla każdej atrakcji; nie dodają lotów ani jedzenia gospodarza."}
  ];
  const knownTotalPLN = round(lines.reduce((sum,x)=>sum+(x.amountPLN??0),0));
  const hasUnknownPrices = unknownItems.length>0 || flightPLN===null;
  const remainingKnownPLN = round(knownTotalPLN - (paidFlightPLN ?? 0));
  return {variant:trip,nights,days,travellers,lines,activities,flightPLN,baggagePLN,etaGBP,urbanGBP,airportGBP,foodGBP,activitiesGBP,
    bookingConfirmed,paidFlightPLN,remainingKnownPLN,remainingPLN:hasUnknownPrices?null:remainingKnownPLN,
    knownTotalPLN,totalPLN:hasUnknownPrices?null:knownTotalPLN,
    alreadyPaidPLN:null,priorTicketExcluded:true,
    hasUnknownPrices,unknownItems,estimatedItems,excludedItems,warnings};
}

/** URL-safe base64 JSON; accepts state only, no browser or Node-specific globals. */
export function encodeState(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  if (bytes.length>50000) throw new RangeError("Planner state too large");
  let binary="";
  for (const byte of bytes) binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}

/** Decodes untrusted link state; malformed/oversized input returns fresh defaults. */
export function decodeState(encoded, data = {}) {
  try {
    if (typeof encoded!=="string" || encoded.length>70000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return defaultState(data);
    const base64=encoded.replace(/-/g,"+").replace(/_/g,"/");
    const binary=atob(base64+"=".repeat((4-base64.length%4)%4));
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    const parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    return sanitizeState(parsed,data);
  } catch { return defaultState(data); }
}
