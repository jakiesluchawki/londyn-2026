// Web-only journal. Preserve the five published datasets consumed by iOS.
export function withTripUpdates(data, updates) {
  const completed = new Map(updates.completed.map(x => [x.id, x]));
  const missed = new Map(updates.notVisited.map(x => [x.id, x]));
  const overlay = item => {
    const record = completed.get(item.id);
    if (record) return {...item, ...record, completed: true,
      description: record.note, why: 'Zapis odbytej wizyty, nie propozycja do kupienia.',
      priceGBP: record.paidGBP,
      priceLabel: record.paidGBP == null ? 'Koszt wizyty niepodany' : `Zapłacone £${record.paidGBP} · Mieszko solo`,
      priceStatus: 'user-reported-paid', availability: 'completed',
      availabilityNote: record.note, verifiedAt: updates.asOf};
    if (missed.has(item.id)) return {...item, visitNote: missed.get(item.id).note};
    return item;
  };
  const known = new Set([...data.events, ...data.places.places].map(x => x.id));
  return {...data, updates, events: data.events.map(overlay), places: {...data.places,
    places: [...data.places.places, ...updates.places,
      ...updates.completed.filter(x => !known.has(x.id))].map(overlay)}};
}
