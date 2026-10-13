# Londyn, w dobrym towarzystwie

Interaktywny, publiczny przewodnik po wyjeździe do Londynu w październiku 2026.
Wizualny kierunek CHMURNIKA i trzy nowe filcowe ilustracje.

## Uruchomienie

Statyczna strona bez bundlera i backendu. `python3 -m http.server 8768` w tym katalogu.
Testy logiki: `node --test tests/planner.test.mjs`.

## Co robi planer

- Pokazuje potwierdzone wspólny wylot 15 X LO281 07:25–09:20 oraz osobne powroty LO280 18:10–21:45: Kostek 19 X, Mieszko 21 X, wszystkie godziny lokalne.
- Zachowuje sześć wariantów z 3 IX jako archiwum, bez wpływu na aktualny plan.
- Rozdziela 1900,92 zł udokumentowanych kosztów lotów (wcześniej 1200,03 zł + zmiana 700,89 zł) od pozostałych wydatków. Walizka 23 kg wraca z Mieszkiem 21 X.
- Liczy atrakcje dla 1–5 osób, ale loty i transfery dla dwóch podróżnych; jedzenie według ich osobnych dat pobytu.
- Pokazuje nieznane ceny, kolizje terminów i status sprawdzenia cen.
- Przechowuje lokalne wybory i udostępnia kopię przez fragment URL, bez synchronizacji online.
- Oddziela aktualny Londyn od historycznego researchu innych miast.

## Dane i prywatność

Nie jest systemem rezerwacji. Loty i bagaż ponownie sprawdzono 13 X: bilet Mieszka z 10 X, Kostka z 4 IX. Aktualizacje rozkładu należy sprawdzać w LOT. Ceny i dostępność atrakcji muszą być ponownie sprawdzone przed zakupem.
Stare zapisy i udostępnione linki zachowują wybory atrakcji, ale nie mogą przywrócić poprzednich lotów, dopłat i bagażu.
Nie publikujemy adresu gospodarza, kontaktów, numerów rezerwacji, dokumentów ani prywatnych playlist.
Publiczny link może zawierać wybory i wpisane kwoty. Brak analityki i zewnętrznych skryptów.
`noindex` nie stanowi kontroli dostępu. To publiczna strona, nie prywatny sejf.

## Pliki

`data/`: publiczne ustalenia i źródła. `planner.mjs`: czysta logika obliczeń.
`app.mjs`: interakcje i renderowanie, `style.css`: responsywny system wizualny.
`assets/`: grafiki i istniejące zasoby typograficzne projektu właściciela CHMURNIK.
Fonty nie są objęte żadną nową licencją open source tego repozytorium.

## Aktualizacja iOS bez wydawania nowej aplikacji

Od 1.0.2 natywne karty i lokalny planer pobierają te same publiczne pliki `data/flights.json`, `events.json`, `places.json`, `archive.json`, `group-musicals.json`. JSON jest danymi, nie kodem do wykonania. Wersja schematu lotów: `schemaVersion: 1`; zachowaj pola i typy używane przez klienta. Zmiana schematu lub funkcji wymaga nowego buildu, aktualizacja zawartości nie.

Edytuj źródłowe JSON, pozostaw rzeczywiste daty weryfikacji, uruchom `node --test tests/planner.test.mjs` i opublikuj na istniejącym GitHub Pages. Klient pobiera komplet, waliduje i zapisuje atomowo. Działa offline z ostatniej poprawnej kopii albo pakietu startowego. Odświeżenie nie oznacza ponownego odczytu Gmail ani odpytania LOT; nie synchronizuje prywatnych wyborów między urządzeniami.

Nie dodawaj PNR, numerów biletów, PDF-ów, danych logowania ani adresu gospodarza do publicznych plików. Powroty zapisuj oddzielnie w `booking.travellers`; najpóźniejsza data musi odpowiadać `return` potwierdzonego wariantu. Kwoty nowych zmian sumuj bez ponownego doliczania starego biletu.
