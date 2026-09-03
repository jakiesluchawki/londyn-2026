# Londyn, w dobrym towarzystwie

Interaktywny, publiczny przewodnik po wyjeździe do Londynu w październiku 2026.
Wizualny kierunek CHMURNIKA i trzy nowe filcowe ilustracje.

## Uruchomienie

Statyczna strona bez bundlera i backendu. `python3 -m http.server 8768` w tym katalogu.
Testy logiki: `node --test tests/planner.test.mjs`.

## Co robi planer

- Porównuje sześć wariantów LOT WAW–LHR, na podstawie odczytów z 3 IX 2026.
- Rozdziela wymianę jednego biletu i zakup drugiego, bez mechanicznego odejmowania starych taryf.
- Liczy atrakcje dla 1–5 osób, ale loty, jedzenie i transfery tylko dla dwóch podróżnych.
- Pokazuje nieznane ceny, kolizje terminów i niepotwierdzony bagaż.
- Przechowuje lokalne wybory i udostępnia kopię przez fragment URL, bez synchronizacji online.
- Oddziela aktualny Londyn od historycznego researchu innych miast.

## Dane i prywatność

Nie jest systemem rezerwacji. Ceny i dostępność muszą być ponownie sprawdzone przed zakupem.
Nie publikujemy adresu gospodarza, kontaktów, numerów rezerwacji, dokumentów ani prywatnych playlist.
Publiczny link może zawierać wybory i wpisane kwoty. Brak analityki i zewnętrznych skryptów.
`noindex` nie stanowi kontroli dostępu. To publiczna strona, nie prywatny sejf.

## Pliki

`data/`: publiczne ustalenia i źródła. `planner.mjs`: czysta logika obliczeń.
`app.mjs`: interakcje i renderowanie, `style.css`: responsywny system wizualny.
`assets/`: grafiki i istniejące zasoby typograficzne projektu właściciela CHMURNIK.
Fonty nie są objęte żadną nową licencją open source tego repozytorium.
