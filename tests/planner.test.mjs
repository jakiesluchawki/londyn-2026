import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {defaultState,sanitizeState,budget,conflicts,activeItems,encodeState,decodeState} from "../planner.mjs";

const load = name => JSON.parse(readFileSync(new URL("../data/"+name+".json",import.meta.url),"utf8"));
// Preserve the original unbooked research as the legacy fixture. Published
// booking facts are tested separately; existing quote-mode tests stay useful.
const publishedData = {flights:load("flights"),events:load("events"),places:load("places")};
const data = {...publishedData,flights:{...publishedData.flights,booking:undefined,
  reissue:{feeEUR:70},luggage:{...publishedData.flights.luggage,fallback:233},
  route:{...publishedData.flights.route,fareGBP:15.5},
  variants:publishedData.flights.variants.filter(x=>x.id!=="15morning-19").map(x=>({...x,recommended:x.id==="15-19"}))}};
const state = patch => ({...defaultState(data),...patch});
const clone = x => JSON.parse(JSON.stringify(x));

test("default plan uses four actual IDs and independent two-person attendance",()=>{
  const s=defaultState(data);
  assert.deepEqual(s.selected,["massaoke","hadestown","adja","kenwood-choir"]);
  assert.equal(s.variant,"15-19");
  s.attendees.adja=3;
  assert.equal(defaultState(data).attendees.adja,2);
});

test("main plan counts one new ticket plus 70 EUR, never both new tickets or the prior ticket",()=>{
  const b=budget(state(),data);
  assert.equal(b.flightPLN,1031);
  assert.equal(b.alreadyPaidPLN,null);
  assert.equal(b.priorTicketExcluded,true);
  assert.equal(b.nights,4);
  assert.equal(b.foodGBP,350);
  assert.equal(b.urbanGBP,63);
  assert.equal(b.airportGBP,62);
  assert.equal(b.etaGBP,40);
  assert.equal(b.activitiesGBP,298.4);
  assert.equal(b.totalPLN,5098);
  assert.ok(b.estimatedItems.includes("hadestown"));
  assert.ok(b.warnings.some(x=>x.code==="baggage-pending"));
});

test("actual hotline extra is added directly even when public fare is cheaper",()=>{
  const b=budget(state({reissueExtraPLN:550,eurPLN:4}),data);
  assert.equal(b.flightPLN,727.9+280+550);
});

test("third attraction attendee does not become a third flier or food traveller",()=>{
  const s=state();
  s.attendees={...s.attendees,adja:3};
  const b=budget(s,data);
  assert.equal(b.activities.find(x=>x.id==="adja").costGBP,120);
  assert.equal(b.flightPLN,1031);
  assert.equal(b.foodGBP,350);
  assert.equal(b.airportGBP,62);
  assert.equal(b.etaGBP,40);
});

test("single shared bag costs 233 once RT, known only on main variant",()=>{
  const main=budget(state({bag:"extra",selected:[]}),data);
  assert.equal(main.baggagePLN,233);
  assert.equal(main.lines.find(x=>x.id==="baggage").estimated,false);
  const other=budget(state({bag:"extra",variant:"14-19",selected:[]}),data);
  assert.equal(other.baggagePLN,233);
  assert.ok(other.warnings.some(x=>x.code==="baggage-estimate"));
  assert.equal(budget(state({bag:"included",selected:[]}),data).baggagePLN,0);
});

test("unknown prices are null, explicit price override resolves incomplete total",()=>{
  const s=state({selected:["sing-out-louise"],bag:"included"});
  let b=budget(s,data);
  assert.equal(b.totalPLN,null);
  assert.equal(b.activities[0].costGBP,null);
  assert.deepEqual(b.unknownItems,["sing-out-louise"]);
  assert.ok(b.knownTotalPLN>0);
  b=budget({...s,prices:{"sing-out-louise":18}},data);
  assert.equal(b.hasUnknownPrices,false);
  assert.equal(b.activities[0].costGBP,36);
  assert.equal(b.activities[0].priceSource,"override");
});

test("genuinely free attraction is not unknown and explicit zero override survives",()=>{
  const b=budget(state({selected:["kenwood-choir"]}),data);
  assert.equal(b.activities[0].costGBP,0);
  assert.equal(b.hasUnknownPrices,false);
  const c=budget(state({selected:["sing-out-louise"],prices:{"sing-out-louise":0}}),data);
  assert.equal(c.totalPLN,c.knownTotalPLN);
});

test("transaction vs per-person fees are applied exactly once at correct scope",()=>{
  const s=state({selected:["mike-lindup","water-body","bfi"]});
  s.attendees={...s.attendees,"mike-lindup":3,"water-body":2,bfi:3};
  const a=budget(s,data).activities;
  assert.equal(a.find(x=>x.id==="mike-lindup").costGBP,96.75);
  assert.equal(a.find(x=>x.id==="water-body").costGBP,26);
  assert.equal(a.find(x=>x.id==="bfi").costGBP,57);
});

test("known out-of-visit events stay selected but are excluded from budget",()=>{
  const s=state({variant:"16-18",selected:["perola-cuba","adja"]});
  const b=budget(s,data);
  assert.deepEqual(s.selected,["perola-cuba","adja"]);
  assert.deepEqual(b.excludedItems,["perola-cuba"]);
  assert.equal(b.hasUnknownPrices,false);
  assert.equal(b.activitiesGBP,80);
  assert.ok(b.warnings.some(x=>x.code==="outside-visit"));
});

test("date ranges overlap visit inclusively and undated options remain unscheduled",()=>{
  const d=clone(data);
  d.places.places.push({id:"past-range",title:"Past",start:"2026-10-01",end:"2026-10-14",priceGBP:999});
  const s=state({selected:["frieze","water-body","hamilton","past-range"]});
  assert.deepEqual(activeItems(s,d).map(x=>x.id).sort(),["frieze","hamilton","water-body"]);
});

test("explicit alternatives and actual overlaps are de-duplicated",()=>{
  const issues=conflicts(state({selected:["hadestown","cabaret","massaoke","blue-lab-beats"]}),data);
  const pair=issues.filter(x=>x.itemIds.includes("hadestown")&&x.itemIds.includes("cabaret"));
  assert.equal(pair.length,1);
  assert.equal(pair[0].code,"time-overlap");
  assert.ok(issues.some(x=>x.code==="alternatives"&&x.itemIds.includes("massaoke")));
});

test("arrival flight catches early show, late arrival and no arrival buffer",()=>{
  assert.ok(conflicts(state({selected:["perola-cuba"]}),data).some(x=>x.code==="arrival-buffer"));
  assert.ok(conflicts(state({variant:"15late-19",selected:["sing-out-louise"]}),data).some(x=>x.code==="arrival-conflict"));
  assert.ok(!conflicts(state({variant:"14-19",selected:["perola-cuba"]}),data).some(x=>x.code.startsWith("arrival")));
});

test("Sunday return rejects evening concert even when only doors are known",()=>{
  const c=conflicts(state({variant:"15-18",selected:["masego","mike-lindup","kenwood-choir"]}),data);
  assert.ok(c.some(x=>x.code==="return-flight"&&x.itemIds.includes("masego")));
  assert.ok(c.some(x=>x.code==="return-flight"&&x.itemIds.includes("mike-lindup")));
  assert.ok(c.some(x=>x.code==="return-tight"&&x.itemIds.includes("kenwood-choir")));
  assert.ok(!c.some(x=>x.severity==="error"&&x.itemIds.includes("kenwood-choir")));
});

test("ISO choir time and overnight durations participate in real overlaps",()=>{
  const d=clone(data);
  d.events.push({id:"choir-clash",title:"Clash",date:"2026-10-18",start:"14:15",end:"15:00",priceGBP:0});
  const c=conflicts(state({selected:["kenwood-choir","choir-clash"]}),d);
  assert.ok(c.some(x=>x.code==="time-overlap"));
  d.events.push({id:"late",title:"Late",date:"2026-10-16",start:"23:30",end:"01:00",priceGBP:0});
  d.events.push({id:"early",title:"Early",date:"2026-10-17",start:"00:30",end:"02:00",priceGBP:0});
  assert.ok(conflicts(state({selected:["late","early"]}),d).some(x=>x.code==="time-overlap"));
});

test("input sanitization rejects hostile or invalid fields without mutating raw data",()=>{
  const raw={variant:"bad",selected:["adja","adja","missing",5],attendees:{adja:50},prices:{adja:-2,massaoke:0},
    eurPLN:Infinity,gbpPLN:"",foodGBP:-10,reissueExtraPLN:-10,etaCount:3,bag:"free",secret:"not retained"};
  const s=sanitizeState(raw,data);
  assert.equal(s.variant,"15-19");
  assert.deepEqual(s.selected,["adja"]);
  assert.equal(s.attendees.adja,2);
  assert.deepEqual(s.prices,{massaoke:0});
  assert.equal(s.eurPLN,4.33);
  assert.equal(s.foodGBP,35);
  assert.equal(s.etaCount,2);
  assert.equal(s.bag,"pending");
  assert.ok(!("secret" in s));
  assert.equal(raw.attendees.adja,50);
  assert.deepEqual(sanitizeState({selected:[]},data).selected,[]);
});

test("share encoding round-trips sanitized state; broken payloads fail closed",()=>{
  const s=state({variant:"14-19",prices:{hadestown:72.5},selected:["hadestown"],etaCount:0});
  const enc=encodeState(s);
  assert.match(enc,/^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeState(enc,data),sanitizeState(s,data));
  assert.deepEqual(decodeState("not!base64",data),defaultState(data));
  assert.deepEqual(decodeState("A".repeat(70001),data),defaultState(data));
  assert.deepEqual(decodeState(encodeState({secret:"żółć",selected:[]}),data).selected,[]);
});

test("array places schema works and input data stays untouched",()=>{
  const before=JSON.stringify(data);
  const arrayData={...data,places:data.places.places};
  assert.ok(activeItems(defaultState(arrayData),arrayData).some(x=>x.id==="kenwood-choir"));
  budget(defaultState(data),data);
  conflicts(defaultState(data),data);
  assert.equal(JSON.stringify(data),before);
});

test("optional dates schedule flexible items only, within the supported trip window",()=>{
  const s=sanitizeState(state({dates:{tate:"2026-10-17",adja:"2026-10-18",hamilton:"2026-10-16",bfi:"2026-10-32","rough-trade":"2026-11-01"}}),data);
  assert.deepEqual(s.dates,{hamilton:"2026-10-16",tate:"2026-10-17"});
  const items=activeItems({...s,selected:["tate","adja","hamilton"]},data);
  assert.equal(items.find(x=>x.id==="tate").date,"2026-10-17");
  assert.equal(items.find(x=>x.id==="adja").date,"2026-10-17");
  assert.equal(data.places.places.find(x=>x.id==="tate").date,undefined);
});

test("scheduled flexible item outside visit is excluded; unscheduled stays included",()=>{
  const s=state({variant:"15-18",selected:["tate","rough-trade"],dates:{tate:"2026-10-19"}});
  assert.deepEqual(budget(s,data).excludedItems,["tate"]);
  assert.deepEqual(activeItems(s,data).map(x=>x.id),["rough-trade"]);
});

test("assigning a festival beyond its actual date range warns instead of fabricating availability",()=>{
  const b=budget(state({selected:["water-body"],dates:{"water-body":"2026-10-19"}}),data);
  assert.equal(b.activitiesGBP,0);
  assert.deepEqual(b.excludedItems,["water-body"]);
  assert.ok(b.warnings.some(x=>x.code==="outside-availability"));
});

test("an assigned flexible event takes part in departure-day checks",()=>{
  const c=conflicts(state({selected:["hamilton"],dates:{hamilton:"2026-10-19"}}),data);
  assert.ok(c.some(x=>x.code==="return-time-unknown"));
});

test("Friday arrival leaves Massaoke feasible but tight via host first",()=>{
  const c=conflicts(state({variant:"16-19",selected:["massaoke"]}),data);
  assert.ok(c.some(x=>x.code==="arrival-buffer"&&x.itemIds.includes("massaoke")));
  assert.ok(!c.some(x=>x.code==="arrival-conflict"));
});

test("earlier ticket value never leaks or influences the public budget",()=>{
  const d=clone(data);
  d.flights.reissue.alreadyPaid=987654;
  const b=budget(state(),d);
  assert.equal(b.alreadyPaidPLN,null);
  assert.equal(b.priorTicketExcluded,true);
  assert.equal(b.totalPLN,5098);
  assert.ok(!JSON.stringify(b).includes("987654"));
});

test("five-person outing preserves two travellers and caps BFI order fees",()=>{
  const s=state({selected:["mike-lindup","water-body","bfi","adja"],etaCount:2});
  s.attendees={...s.attendees,"mike-lindup":5,"water-body":5,bfi:5,adja:5};
  const b=budget(s,data);
  assert.equal(b.activities.find(x=>x.id==="mike-lindup").costGBP,160.25);
  assert.equal(b.activities.find(x=>x.id==="mike-lindup").feeGBP,1.5);
  assert.equal(b.activities.find(x=>x.id==="water-body").costGBP,63);
  assert.equal(b.activities.find(x=>x.id==="water-body").feeGBP,3);
  assert.equal(b.activities.find(x=>x.id==="bfi").costGBP,93);
  assert.equal(b.activities.find(x=>x.id==="adja").costGBP,200);
  assert.equal(b.travellers,2);
  assert.equal(b.flightPLN,1031);
  assert.equal(b.foodGBP,350);
  assert.equal(b.airportGBP,62);
  assert.equal(b.etaGBP,40);
});

test("attendance accepts four and five but rejects larger or fractional counts",()=>{
  const s=sanitizeState(state({attendees:{adja:5,hadestown:4,massaoke:6,bfi:2.5},etaCount:5}),data);
  assert.equal(s.attendees.adja,5);
  assert.equal(s.attendees.hadestown,4);
  assert.equal(s.attendees.massaoke,2);
  assert.equal(s.attendees.bfi,2);
  assert.equal(s.etaCount,2);
});

test("new group musical data merged by UI is selectable without module changes",()=>{
  const d=clone(data);
  d.events.push({id:"group-show",title:"Group Show",category:"musical",date:null,priceGBP:55,priceStatus:"estimate"});
  const s=sanitizeState({selected:["group-show"],attendees:{"group-show":5}},d);
  const b=budget(s,d);
  assert.equal(b.activities[0].attendees,5);
  assert.equal(b.activities[0].costGBP,275);
  assert.equal(b.flightPLN,1031);
});

function sessionFixture() {
  const d=clone(data);
  const h=d.events.find(x=>x.id==="hadestown");
  h.sessions=[
    {id:"h-sat-mat",date:"2026-10-17",start:"14:30",end:"17:00",label:"Saturday matinee"},
    {id:"h-sat-eve",date:"2026-10-17",start:"19:30",end:"22:00",label:"Saturday evening"},
    {id:"h-sun",date:"2026-10-18",start:"15:00",end:"17:30",label:"Sunday"}
  ];
  delete h.defaultSession;
  const c=d.events.find(x=>x.id==="cabaret");
  c.sessions=[{id:"c-sat",date:"2026-10-17",start:"14:00",end:"16:45",label:"Saturday"}];
  delete c.defaultSession;
  return d;
}

test("closed weekdays exclude assigned places and leave unscheduled options available",()=>{
  const d=clone(data);
  d.places.places.find(x=>x.id==="borough").availableWeekdays=[0,2,3,4,5,6];
  d.events.find(x=>x.id==="hamilton").availableWeekdays=[1,2,3,4,5,6];
  const s=state({selected:["borough","hamilton"],dates:{borough:"2026-10-19",hamilton:"2026-10-18"}});
  const b=budget(s,d);
  assert.deepEqual(b.excludedItems.sort(),["borough","hamilton"]);
  assert.equal(b.activitiesGBP,0);
  assert.equal(b.warnings.filter(x=>x.code==="closed-day").length,2);
  assert.equal(activeItems({...s,dates:{}},d).length,2);
  assert.equal(activeItems({...s,dates:{borough:"2026-10-16",hamilton:"2026-10-17"}},d).length,2);
});

test("verified sessions preserve base default, override fixed date and block arbitrary date edits",()=>{
  const d=sessionFixture();
  assert.equal(defaultState(d).sessions.hadestown,"h-sat-mat");
  const s=sanitizeState({selected:["hadestown"],sessions:{hadestown:"h-sun"},dates:{hadestown:"2026-10-19"}},d);
  assert.equal(s.sessions.hadestown,"h-sun");
  assert.equal(s.dates.hadestown,undefined);
  const item=activeItems(s,d)[0];
  assert.equal(item.date,"2026-10-18");
  assert.equal(item.start,"15:00");
  assert.equal(item.end,"17:30");
  assert.equal(item.sessionId,"h-sun");
  assert.equal(d.events.find(x=>x.id==="hadestown").date,"2026-10-17");
});

test("session choices do not create false conflicts across days or disjoint known times",()=>{
  const d=sessionFixture();
  let s={...defaultState(d),selected:["hadestown","cabaret"],sessions:{hadestown:"h-sun",cabaret:"c-sat"}};
  assert.ok(!conflicts(s,d).some(x=>x.itemIds.includes("hadestown")&&x.itemIds.includes("cabaret")));
  s.sessions.hadestown="h-sat-eve";
  assert.ok(!conflicts(s,d).some(x=>x.itemIds.includes("hadestown")&&x.itemIds.includes("cabaret")));
  s.sessions.hadestown="h-sat-mat";
  assert.equal(conflicts(s,d).filter(x=>x.code==="time-overlap").length,1);
});

test("Saturday evening Hadestown genuinely overlaps Adja and Sunday session affects flight warning",()=>{
  const d=sessionFixture();
  const s={...defaultState(d),selected:["hadestown","adja"],sessions:{hadestown:"h-sat-eve"}};
  assert.ok(conflicts(s,d).some(x=>x.code==="time-overlap"&&x.itemIds.includes("adja")));
  assert.ok(conflicts({...s,variant:"15-18",selected:["hadestown"],sessions:{hadestown:"h-sun"}},d).some(x=>x.code==="return-buffer"));
});

test("untrusted sessions are whitelisted and survive share roundtrip without arbitrary payloads",()=>{
  const d=sessionFixture();
  const s=sanitizeState({selected:["hadestown"],sessions:{hadestown:"h-sun",missing:"x",adja:{date:"2026-10-19"}}},d);
  assert.equal(s.sessions.hadestown,"h-sun");
  assert.equal(s.sessions.missing,undefined);
  assert.equal(s.sessions.adja,undefined);
  assert.deepEqual(decodeState(encodeState(s),d),s);
  assert.equal(sanitizeState({sessions:{hadestown:"invented"}},d).sessions.hadestown,"h-sat-mat");
  d.events.find(x=>x.id==="hadestown").sessions.push({id:"bad-time",date:"2026-10-17",start:"99:00",end:"99:30"});
  assert.equal(sanitizeState({sessions:{hadestown:"bad-time"}},d).sessions.hadestown,"h-sat-mat");
});


test("explicit per-person theatre fee charges all five attendees, independent of base-price override",()=>{
  const d=clone(data);
  d.events.push(...load("group-musicals").recommendations);
  const item=d.events.find(x=>x.id==="book-of-mormon");
  const s={...defaultState(d),selected:[item.id],attendees:{[item.id]:5}};
  let b=budget(s,d);
  assert.equal(b.activities[0].feeGBP,12.5);
  assert.equal(b.activities[0].costGBP,item.priceGBP*5+12.5);
  assert.equal(b.flightPLN,1031);
  b=budget({...s,prices:{[item.id]:100}},d);
  assert.equal(b.activities[0].costGBP,512.5);
  assert.equal(b.activities[0].feeGBP,12.5);
  item.feePerPersonGBP=-1;
  assert.equal(budget(s,d).activities[0].feeGBP,0);
});


function confirmedFixture() {
  const d=sessionFixture();
  d.flights.variants.push({id:"15morning-19",departure:"2026-10-15",return:"2026-10-19",
    out:"07:25",arrival:"09:20",back:"18:10",home:"21:45",outFlight:"LO281",returnFlight:"LO280",nights:4});
  d.flights.booking={confirmed:true,variantId:"15morning-19",exchangePaidPLN:600,kostekPaidPLN:600.03,checkedIncluded:true,verifiedAt:"2026-09-04"};
  return d;
}

test("confirmed booking migrates legacy inputs without losing attraction choices or sessions",()=>{
  const d=confirmedFixture();
  const raw={version:1,variant:"15late-19",selected:["hadestown","adja","tate","rough-trade"],
    attendees:{hadestown:5,adja:4,tate:3},prices:{hadestown:72.5},
    dates:{tate:"2026-10-16","rough-trade":"2026-10-14"},sessions:{hadestown:"h-sun"},
    etaCount:0,foodGBP:42,gbpPLN:5.2,eurPLN:4.5,reissueExtraPLN:999,bag:"extra"};
  const before=JSON.stringify(raw),s=sanitizeState(raw,d);
  assert.equal(s.version,1);
  assert.equal(s.variant,"15morning-19");
  assert.equal(s.bag,"included");
  assert.equal(s.reissueExtraPLN,0);
  assert.deepEqual(s.selected,raw.selected);
  assert.deepEqual(s.prices,raw.prices);
  assert.deepEqual(s.dates,raw.dates);
  assert.equal(s.sessions.hadestown,"h-sun");
  assert.equal(s.attendees.hadestown,5);
  assert.equal(s.attendees.adja,4);
  assert.equal(s.attendees.tate,3);
  assert.equal(s.etaCount,0);
  assert.equal(s.foodGBP,42);
  assert.equal(s.gbpPLN,5.2);
  assert.equal(JSON.stringify(raw),before);
  assert.deepEqual(budget(s,d).excludedItems,["rough-trade"]);
  assert.deepEqual(decodeState(encodeState(raw),d),s);
  assert.deepEqual(sanitizeState({...raw,selected:[]},d).selected,[]);
});

test("confirmed defaults and malformed legacy links use the booked morning itinerary",()=>{
  const d=confirmedFixture(),s=defaultState(d);
  assert.equal(s.variant,"15morning-19");
  assert.equal(s.bag,"included");
  assert.equal(s.reissueExtraPLN,0);
  assert.deepEqual(decodeState("broken!",d),s);
  assert.equal(budget(s,d).variant.outFlight,"LO281");
  assert.equal(budget(s,d).variant.arrival,"09:20");
});

test("paid flights ignore legacy fare inputs, public prices, currency rates and baggage fallback",()=>{
  const d=confirmedFixture();
  d.flights.reissue={feeEUR:999,alreadyPaid:987654};
  d.flights.luggage.fallback=999;
  d.flights.variants.find(x=>x.id==="15morning-19").newTicket=9999;
  const b=budget({version:1,variant:"14-19",selected:[],eurPLN:100,gbpPLN:7,
    reissueExtraPLN:999,bag:"extra",booking:{exchangePaidPLN:9999}},d);
  assert.equal(b.bookingConfirmed,true);
  assert.equal(b.flightPLN,1200.03);
  assert.equal(b.paidFlightPLN,1200.03);
  assert.equal(b.baggagePLN,0);
  assert.equal(b.lines.find(x=>x.id==="flights").estimated,false);
  assert.equal(b.lines.find(x=>x.id==="baggage").estimated,false);
  assert.ok(!b.warnings.some(x=>x.code.startsWith("baggage")));
  assert.equal(b.alreadyPaidPLN,null);
  assert.equal(b.priorTicketExcluded,true);
  assert.ok(!JSON.stringify(b).includes("987654"));
});

test("remaining budget excludes exactly the already paid flight cost",()=>{
  const d=confirmedFixture(),b=budget(defaultState(d),d);
  assert.equal(b.knownTotalPLN,5267.03);
  assert.equal(b.totalPLN,5267.03);
  assert.equal(b.remainingKnownPLN,4067);
  assert.equal(b.remainingPLN,4067);
  assert.equal(b.paidFlightPLN+b.remainingKnownPLN,b.knownTotalPLN);
  const legacy=budget(defaultState(data),data);
  assert.equal(legacy.bookingConfirmed,false);
  assert.equal(legacy.paidFlightPLN,0);
  assert.equal(legacy.remainingPLN,legacy.totalPLN);
});

test("unknown attraction prices keep the remaining total partial after flights are paid",()=>{
  const d=confirmedFixture();
  const s={...defaultState(d),selected:["perola-cuba"]};
  const b=budget(s,d);
  assert.equal(b.paidFlightPLN,1200.03);
  assert.equal(b.totalPLN,null);
  assert.equal(b.remainingPLN,null);
  assert.equal(b.remainingKnownPLN,2575);
  assert.equal(b.knownTotalPLN,3775.03);
  assert.deepEqual(b.unknownItems,["perola-cuba"]);
  const priced=budget({...s,prices:{"perola-cuba":20}},d);
  assert.equal(priced.remainingPLN,2775);
  assert.equal(priced.totalPLN,3975.03);
});

test("confirmed payment data does not depend on a public fare and missing paid costs fail closed",()=>{
  const d=confirmedFixture();
  assert.equal(d.flights.variants.find(x=>x.id==="15morning-19").newTicket,undefined);
  assert.equal(budget(defaultState(d),d).flightPLN,1200.03);
  delete d.flights.booking.kostekPaidPLN;
  const b=budget(defaultState(d),d);
  assert.equal(b.bookingConfirmed,true);
  assert.equal(b.flightPLN,null);
  assert.equal(b.paidFlightPLN,null);
  assert.equal(b.totalPLN,null);
  assert.equal(b.remainingPLN,null);
  assert.ok(b.warnings.some(x=>x.code==="flight-price-unknown"));
});

test("confirmed morning arrival replaces stale late-flight logistics without fabricating early access",()=>{
  const d=confirmedFixture();
  const lateState={...state(),variant:"15late-19",selected:["perola-cuba","sing-out-louise"]};
  assert.ok(!conflicts(lateState,d).some(x=>x.code.startsWith("arrival")));
  d.events.push(
    {id:"before-landing",title:"Before landing",category:"concert",date:"2026-10-15",start:"08:30",end:"09:30",priceGBP:0},
    {id:"too-soon",title:"Too soon",category:"concert",date:"2026-10-15",start:"10:30",end:"11:30",priceGBP:0}
  );
  const issues=conflicts({...lateState,selected:["before-landing","too-soon"]},d);
  assert.ok(issues.some(x=>x.code==="arrival-conflict"&&x.itemIds.includes("before-landing")));
  assert.ok(issues.some(x=>x.code==="arrival-buffer"&&x.itemIds.includes("too-soon")));
});


test("Monday plan includes the return to Brent Cross for the shared suitcase",()=>{
  const d=clone(data);
  d.events.push({id:"mon-safe",title:"Morning",date:"2026-10-19",start:"10:00",end:"11:45",priceGBP:0});
  d.events.push({id:"mon-tight",title:"Lunch",date:"2026-10-19",start:"11:00",end:"12:30",priceGBP:0});
  d.events.push({id:"mon-late",title:"Too late",date:"2026-10-19",start:"12:00",end:"13:30",priceGBP:0});
  d.events.push({id:"mon-start-late",title:"Late start",date:"2026-10-19",start:"13:00",end:"14:00",priceGBP:0});
  const issues=conflicts(state({variant:"15-19",selected:["mon-safe","mon-tight","mon-late","mon-start-late"]}),d);
  assert.ok(!issues.some(x=>x.code.startsWith("return")&&x.itemIds.includes("mon-safe")));
  assert.ok(issues.some(x=>x.code==="return-tight"&&x.itemIds.includes("mon-tight")));
  assert.ok(issues.some(x=>x.code==="return-buffer"&&x.itemIds.includes("mon-late")));
  assert.ok(issues.some(x=>x.code==="return-flight"&&x.itemIds.includes("mon-start-late")));
});
