# Pokémon-Sammlung

Eine kleine Web-App, um unsere Pokémon-Karten zu verwalten: Was haben wir, wem gehört welche Karte, was ist sie wert, und wie finden wir sie?

## Starten

Einfach `index.html` im Browser öffnen. Es gibt keinen Build-Schritt und keinen Server. Für die Kartensuche und die Preise braucht man Internet.

Zum Hosten (z. B. GitHub Pages, Netlify) reicht es, den Ordner `pokemon-sammlung/` hochzuladen.

## Funktionen

- **Karten suchen** mit deutschen oder englischen Namen (z. B. „Glurak“), optional mit Kartennummer
- **Zur Sammlung hinzufügen** mit Besitzer, Anzahl, Zustand (MT … PO), Variante (Normal/Reverse/Holo/1. Edition), Kartensprache, Grading (PSA …), Kaufpreis, eigenem Wert, Notiz und Favorit
- **Bewerten**: eigene 1–5-Sterne-Bewertung und Marktwert (Cardmarket-Trendpreis in EUR, je nach Variante)
- **Mehrere Sammler**: jedes Familienmitglied mit eigener Farbe, filterbar
- **Wunschliste** für Karten, die noch fehlen
- **Statistik**: Gesamtwert, Gewinn/Verlust gegenüber dem Kaufpreis, wertvollste Karten, Wert pro Sammler, Sets, Seltenheiten, Typen
- **Preise aktualisieren** auf Knopfdruck
- **Manuell eintragen**, falls eine Karte nicht in der Datenbank steht
- **Export/Import** als JSON (Sicherung oder Umzug auf ein anderes Gerät) und als CSV (für Excel)

## Daten

- Kartendaten, Bilder und Preise kommen von der freien [TCGdex-API](https://tcgdex.dev). Die Preise stammen von Cardmarket.
- Die Sammlung wird im `localStorage` des jeweiligen Browsers gespeichert. Deshalb regelmäßig über *Einstellungen → Sicherung exportieren* sichern.
