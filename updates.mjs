// Web-only journal. Preserve the five published datasets consumed by iOS.
export function withTripUpdates(data, updates) {
  const completed = new Map(updates.completed.map(x => [x.id, x]));
  const notes = new Map([...updates.notVisited, ...(updates.itemNotes || [])].map(x => [x.id, x]));
  const overlay = item => {
    const record = completed.get(item.id);
    if (record) return {...item, ...record, completed: true,
      // Research slots and locally assigned days are not evidence of when
      // a reported visit happened. Null means the actual day is unknown.
      date: record.date ?? null, start: null, end: null, durationMinutes: null,
      sessions: [], defaultSession: undefined, suggestedDate: undefined,
      description: record.note, why: 'Zapis odbytej wizyty, nie propozycja do kupienia.',
      priceGBP: record.paidGBP,
      priceLabel: record.paidGBP == null ? 'Koszt wizyty niepodany' : `Zapłacone £${record.paidGBP} · Mieszko solo`,
      priceStatus: record.paidGBP == null ? 'user-reported-visit' : 'user-reported-paid', availability: 'completed',
      availabilityNote: record.note, verifiedAt: updates.asOf};
    if (notes.has(item.id)) return {...item, visitNote: notes.get(item.id).note};
    return item;
  };
  const known = new Set([...data.events, ...data.places.places].map(x => x.id));
  return {...data, updates, events: data.events.map(overlay), places: {...data.places,
    places: [...data.places.places, ...updates.places,
      ...updates.completed.filter(x => !known.has(x.id))].map(overlay)}};
}
