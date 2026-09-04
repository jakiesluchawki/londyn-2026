# Londyn, w dobrym towarzystwie

Interaktywny, publiczny przewodnik po wyjeździe do Londynu w październiku 2026.
Wizualny kierunek CHMURNIKA i trzy nowe filcowe ilustracje.

## Uruchomienie

Statyczna strona bez bundlera i backendu. `python3 -m http.server 8768` w tym katalogu.
Testy logiki: `node --test tests/planner.test.mjs`.

## Co robi planer

- Pokazuje potwierdzone loty 15–19 X: LO281 07:25–09:20 i LO280 18:10–21:45, wszystkie godziny lokalne.
- Zachowuje sześć wariantów z 3 IX jako archiwum, bez wpływu na aktualny plan.
- Rozdziela 1200,03 zł opłaconych lotów (600 zł cała wymiana + 600,03 zł nowy bilet) od pozostałych wydatków. Jedna walizka 23 kg jest w cenie.
- Liczy atrakcje dla 1–5 osób, ale loty, jedzenie i transfery tylko dla dwóch podróżnych.
- Pokazuje nieznane ceny, kolizje terminów i status sprawdzenia cen.
- Przechowuje lokalne wybory i udostępnia kopię przez fragment URL, bez synchronizacji online.
- Oddziela aktualny Londyn od historycznego researchu innych miast.

## Dane i prywatność

Nie jest systemem rezerwacji. Loty i bagaż odczytano z dwóch e-biletów 4 IX 2026. Aktualizacje rozkładu należy sprawdzać w LOT. Ceny i dostępność atrakcji muszą być ponownie sprawdzone przed zakupem.
Stare zapisy i udostępnione linki zachowują wybory atrakcji, ale nie mogą przywrócić poprzednich lotów, dopłat i bagażu.
Nie publikujemy adresu gospodarza, kontaktów, numerów rezerwacji, dokumentów ani prywatnych playlist.
Publiczny link może zawierać wybory i wpisane kwoty. Brak analityki i zewnętrznych skryptów.
`noindex` nie stanowi kontroli dostępu. To publiczna strona, nie prywatny sejf.

## Pliki

`data/`: publiczne ustalenia i źródła. `planner.mjs`: czysta logika obliczeń.
`app.mjs`: interakcje i renderowanie, `style.css`: responsywny system wizualny.
`assets/`: grafiki i istniejące zasoby typograficzne projektu właściciela CHMURNIK.
Fonty nie są objęte żadną nową licencją open source tego repozytorium.
